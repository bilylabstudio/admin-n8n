# Adjuntos de Email en Tickets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the review admin attach files to outgoing replies, show/download attachments on received emails, and persist real attachments on the "Sent" IMAP copy — replicating normal email attachment behaviour end to end.

**Architecture:** New `TicketAttachment` model (pointing at either a `Ticket` or a `ThreadMessage`) with disk storage mirroring `FormImage`/`form-uploads.ts`. Attachments are staged via `POST /api/attachments` before a message is sent, referenced by id at send time, and forwarded to n8n as base64 in the existing `sendApprovedReply` payload. Inbound attachments arrive via a new n8n-facing endpoint called right after ticket ingestion. See the companion design doc for full rationale: `docs/superpowers/specs/2026-09-17-adjuntos-email-tickets-design.md`.

**Tech Stack:** Next.js App Router route handlers, Prisma/PostgreSQL, `file-type` for MIME sniffing (already a dependency), Vitest, n8n webhook JSON contract (external repo/workflow).

---

### Task 1: Data Model And Storage

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260917000000_add_ticket_attachments/migration.sql`
- Create: `src/lib/ticket-attachments.ts`
- Create: `src/lib/ticket-attachments.test.ts`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`

- [ ] Add the `TicketAttachment` model (fields per the design doc: `ticketId`/`threadMessageId` nullable FKs, `direction`, `source`, `filename`, `storagePath`, `mimeType`, `sizeBytes`, `uploadedByUserId`, `createdAt`), reusing the existing `ThreadMessageDirection`/`ThreadMessageSource` enums.
- [ ] Add the inverse relations on `Ticket`, `ThreadMessage`, and `User`, plus `@@index([ticketId])` / `@@index([threadMessageId])`.
- [ ] Write the migration SQL by hand (create table, FKs with `ON DELETE CASCADE`, indexes) following the style of the existing hand-written migrations under `prisma/migrations/`.
- [ ] Add `TICKET_ATTACHMENTS_ROOT`, `TICKET_ATTACHMENT_MAX_BYTES` (default 10MB), `TICKET_ATTACHMENT_MAX_FILES` (default 5), `TICKET_ATTACHMENT_TOTAL_MAX_BYTES` (default 25MB) to `env.ts` and `.env.example`, documented in the README next to the existing `FORM_UPLOADS_ROOT` section.
- [ ] Implement `src/lib/ticket-attachments.ts` mirroring `form-uploads.ts`: `validateUpload` (size + `file-type` sniff against the allowed list: jpeg/png/webp/heic, pdf, doc, docx, xls, xlsx, zip), `writeTicketAttachment(s)`, `absolutePathFor`, `deleteTicketAttachment`, id-safety helpers (ticket/thread-message ids are cuids, same regex guard as `assertFormIdSafe`).
- [ ] Test: mime allow/deny, per-file size limit, file count limit, total size limit, path traversal safety.

### Task 2: Admin-Facing Attachment Endpoints (stage / delete / serve)

**Files:**
- Create: `src/app/api/attachments/route.ts` (POST — stage)
- Create: `src/app/api/attachments/[id]/route.ts` (GET — serve, DELETE — unstage)
- Create: `src/app/api/attachments/[id]/route.test.ts`

- [ ] `POST /api/attachments`: require `currentUser()`; multipart body with one `file` + `ticket_id` (or `thread_message_id` for a message that already exists, e.g. a resend scenario); validate via Task 1's lib; write to disk; create the `TicketAttachment` row (`direction=outbound`, `source=admin`, `uploadedByUserId`); return `{ id, filename, mimeType, sizeBytes }`.
- [ ] `GET /api/attachments/[id]`: require `currentUser()`; stream the file with `Content-Type`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`; `Content-Disposition: inline` by default, `attachment` when `?download=1`.
- [ ] `DELETE /api/attachments/[id]`: require `currentUser()`; refuse (409) if the row is already linked to a sent `ThreadMessage` or a sent ticket status; otherwise delete the file and the row.
- [ ] Tests: unauthenticated rejection on all three, delete-after-sent rejection, view vs download headers.

### Task 3: n8n-Facing Inbound Attachment Ingest

**Files:**
- Create: `src/app/api/n8n/tickets/[id]/attachments/route.ts`
- Create: `src/app/api/n8n/tickets/[id]/attachments/route.test.ts`

- [ ] `POST /api/n8n/tickets/[id]/attachments`: require `X-N8N-Ingest-Token` == `env.N8N_INGEST_SECRET` (same guard as `/api/n8n/tickets`); accept multipart with one or more `file` parts; 404 if the ticket id doesn't exist; validate each file independently (best-effort — one bad file returns a `skipped` entry with a reason, doesn't fail the whole request); create `TicketAttachment` rows (`direction=inbound`, `source=webmail`).
- [ ] Response shape: `{ ok: true, attachments: [{ id, filename, mimeType, sizeBytes }], skipped: [{ filename, reason }] }`.
- [ ] Tests: wrong/missing token, unknown ticket id, oversized/disallowed file skipped without failing the request, happy path with multiple files.

### Task 4: Wire Attachments Into The Send Paths + n8n Payload

**Files:**
- Modify: `src/lib/n8n.ts`
- Modify: `src/app/api/tickets/[id]/send/route.ts`
- Modify: `src/app/api/customers/[email]/thread/send/route.ts`

- [ ] Extend `SendApprovedPayload` with optional `attachments: { filename, mime_type, content_base64 }[]`.
- [ ] Extend `SentMessagePayload`/`N8nSendResult`'s `sent_message` with optional `attachments: { filename, mime_type, size_bytes }[]` (n8n's echo-back).
- [ ] `/api/tickets/[id]/send`: read `attachment_ids` (repeated form field) from the posted form; load and validate those `TicketAttachment` rows belong to this ticket and are still unsent; base64-encode file contents into the n8n payload; on success, leave rows as-is (already `ticketId`-scoped); on failure, leave them staged.
- [ ] `/api/customers/[email]/thread/send`: read `attachment_ids` from the JSON body; same loading/validation (scoped to this customer's tickets); on success, after creating the `ThreadMessage`, update those rows' `threadMessageId`; on failure, leave staged.
- [ ] Guard total base64 payload size against `TICKET_ATTACHMENT_TOTAL_MAX_BYTES` before calling n8n (fail fast with a clear error instead of sending an oversized webhook body).

### Task 5: Sent-Copy RFC822 With Real Attachments

**Files:**
- Modify: `src/lib/webmail-sync.ts`
- Modify: `src/lib/webmail-sync.test.ts`

- [ ] Change `buildRfc822Message` to accept an optional `attachments: { filename, mimeType, contentBase64 }[]` and, when non-empty, wrap the existing `multipart/alternative` part inside an outer `multipart/mixed`, appending one base64 attachment part per file (76-column wrapped body, `Content-Disposition: attachment; filename="..."`).
- [ ] With an empty/absent `attachments` array, output must stay byte-identical to the current implementation (regression guard).
- [ ] Update both call sites (`/api/tickets/[id]/send`, `/api/customers/[email]/thread/send`) to pass through the attachments actually confirmed by n8n's `sent_message.attachments` (not just what was requested), so the sent-folder copy reflects reality.
- [ ] Tests: zero-attachment output unchanged, single attachment, multiple attachments, base64 round-trips back to the original bytes.

### Task 6: Composer UI — Attach Before Sending

**Files:**
- Modify: `src/app/inbox-client.tsx`

- [ ] Add attachment state (staged files: id/filename/size/status) to the composer area(s) that already own `draft`/`dirty` state.
- [ ] Paperclip button + hidden `<input type="file" multiple>`; on selection, upload each file to `POST /api/attachments` with the current `ticket_id`/customer context; render chips with filename, human-readable size, spinner while in flight, and a remove "×" calling `DELETE /api/attachments/[id]`.
- [ ] Disable the send button while any chip is uploading; include `attachment_ids` in `submitAction`'s form body and `submitThreadFollowUp`'s JSON body; clear staged chips on a successful send, keep them on failure.
- [ ] Reuse the same component/state shape across the composer instances in this file (ticket-review composer and the two follow-up composer variants already present).

### Task 7: Thread UI — View/Download Attachments On Any Message

**Files:**
- Modify: `src/lib/thread-messages.ts`
- Modify: `src/lib/thread-messages.test.ts`
- Modify: `src/app/api/customers/[email]/thread/route.ts`
- Modify: `src/app/inbox-client.tsx`

- [ ] Add `attachments: { id, filename, mimeType, sizeBytes }[]` to `ThreadMessageView`; thread it through `ticketToThreadMessages` and `storedThreadMessageToView`.
- [ ] In `GET /api/customers/[email]/thread`, batch-load `TicketAttachment` rows for all ticket ids and stored thread-message ids on the page (one query per kind, keyed by id, same pattern as the existing tag lookups) and attach them to the right message before returning.
- [ ] Render a chip row under any bubble that has attachments: mime-based icon, filename, size, "Ver" (`GET /api/attachments/{id}` in a new tab) and "Descargar" (`?download=1`).
- [ ] Test: attachments array survives `ticketToThreadMessages`/`storedThreadMessageToView`/dedupe unchanged.

### Task 8 (optional / lower priority): Legacy Ticket Detail Page

**Files:**
- Modify: `src/app/tickets/[id]/page.tsx`

- [ ] Add `enctype="multipart/form-data"` and a `<input type="file" name="attachments" multiple>` to the existing send `<form>`, and adjust `/api/tickets/[id]/send` to also accept raw files directly on this path (upload-and-send in one step, no staging UX) for this no-JS fallback view.

### Task 9 (optional / follow-up, not required for v1): Orphaned-Attachment Cleanup

**Files:**
- Create: `scripts/cleanup-orphan-attachments.ts`
- Modify: `package.json` (new script entry, same idea as `cleanup:expired-forms`)

- [ ] Delete outbound `TicketAttachment` rows (+ files) that were staged but never linked to a sent ticket/thread message after N days, or whose parent ticket ended up `discarded`. Intended to run on the same Easypanel cron cadence as `cleanup:expired-forms`.

### Task 10 (external — not implemented in this repo): n8n Workflow Changes

Documented in full in the design doc's "n8n contract changes" section. Summary for whoever maintains the n8n workflows:
- [ ] Inbound workflow: after `POST /api/n8n/tickets`, extract each attachment from the source email's MIME structure and `POST` it to `/api/n8n/tickets/{ticket_id}/attachments` (multipart, `X-N8N-Ingest-Token` header).
- [ ] Outbound "send approved reply" workflow: read the new `attachments` array on the incoming webhook payload, base64-decode each item, attach it to the outgoing mail node, and echo back what was actually attached in `sent_message.attachments`.


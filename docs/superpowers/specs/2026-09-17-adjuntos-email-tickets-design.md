# Adjuntos de Email en Tickets — Design

## Goal

Make the review admin handle email attachments the same way a normal mail client does, end to end:

1. Attach a file to an outgoing reply (ticket approval or a follow-up message) before sending.
2. Open/preview an attachment that came in on a received customer email.
3. Send a message with an attachment, and have that attachment actually leave as a real email attachment (not just a link).
4. Download or view any attachment (inbound or outbound) from inside the tool at any later time.

## Scope

In scope:
- New `TicketAttachment` Prisma model, storage on disk (same pattern as `FormImage`/`form-uploads.ts`), and CRUD/serving endpoints inside this app.
- Admin-side composer UI to stage attachments before sending, and thread UI to view/download attachments on any message (inbound or outbound).
- Extending the two existing send paths (`/api/tickets/[id]/send`, `/api/customers/[email]/thread/send`) to include staged attachments.
- Extending `SendApprovedPayload`/`SentMessagePayload` (the JSON contract with the n8n "send approved reply" webhook) to carry attachment content, so n8n can actually attach the files to the outgoing email.
- Extending `buildRfc822Message` (the copy the app appends to the IMAP "Sent" folder) to a real `multipart/mixed` message with attachment parts, so the sent-folder copy looks like a normal sent email with attachments, not just text.
- A new n8n-facing ingest endpoint so n8n can push attachments it found on an inbound email onto the ticket it just created.
- Documenting (not implementing — n8n lives outside this repo) exactly what the n8n workflows need to change on both the inbound and outbound side.

Out of scope for this iteration:
- Building/editing the n8n workflows themselves.
- Virus/malware scanning of uploaded files (flagged as a follow-up recommendation).
- Attachments on the public devolución customer form (that already has its own image upload flow via `FormImage`; unrelated to email attachments).
- Full-text indexing/preview of document contents (only binary preview/download).

## Current State (why this needs new plumbing)

This app does not send email itself. n8n reads the mailbox, creates the ticket (`POST /api/n8n/tickets`), and once a human approves in the panel, this app calls an n8n webhook (`sendApprovedReply` in `src/lib/n8n.ts`) which is the thing that actually delivers the email. After a successful send, this app only does IMAP housekeeping (`src/lib/webmail-sync.ts`): flags the original message as answered, and optionally appends a `multipart/alternative` (text+html) RFC822 copy to the "Sent" mailbox.

None of that plumbing carries file bytes today:
- `ingestTicketSchema` (`src/lib/tickets.ts`) has no attachment fields; inbound emails are stored as plain `originalText`.
- `SendApprovedPayload`/`SentMessagePayload` (`src/lib/n8n.ts`) are plain JSON with no attachment field.
- `buildRfc822Message` only builds two text parts, no binary parts.
- There is no `Attachment` table. The only existing attachment/upload code is `FormImage` + `src/lib/form-uploads.ts`, built for the devolución customer form (images only, 5MB/3 files) — a good pattern to copy, not something to reuse directly (different auth boundary, different mime types, different lifecycle).

Two structural facts drive the data model:
- An **inbound** message (initial or a follow-up from the customer) is stored as a `Ticket` row, not a `ThreadMessage` row (`ticketToThreadMessages()` in `src/lib/thread-messages.ts` synthesizes the inbound bubble from ticket fields).
- An **outbound** message is either "the reply to a ticket" (still just the `Ticket` row, once sent) or a `ThreadMessage` row created by the follow-up send route.

So an attachment must be able to point at either a `Ticket` or a `ThreadMessage`, tagged with a direction.

## Architecture

### Data model

Add one new model, mirroring `FormImage`:

```prisma
model TicketAttachment {
  id              String                 @id @default(cuid())
  ticketId        String?
  ticket          Ticket?                @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  threadMessageId String?
  threadMessage   ThreadMessage?         @relation(fields: [threadMessageId], references: [id], onDelete: Cascade)
  direction       ThreadMessageDirection
  source          ThreadMessageSource
  filename        String
  storagePath     String
  mimeType        String
  sizeBytes       Int
  uploadedByUserId String?
  uploadedBy      User?                  @relation(fields: [uploadedByUserId], references: [id], onDelete: SetNull)
  createdAt       DateTime               @default(now())

  @@index([ticketId])
  @@index([threadMessageId])
}
```

Reuses the existing `ThreadMessageDirection` (`inbound`/`outbound`) and `ThreadMessageSource` (`admin`/`webmail`) enums instead of inventing new ones. Add the inverse relations (`attachments TicketAttachment[]`) on `Ticket`, `ThreadMessage` and `User`.

Rows have exactly one of `ticketId` / `threadMessageId` set:
- Inbound attachment on the original/customer email → `ticketId` set, `direction=inbound`, `source=webmail`.
- Outbound attachment that is the reply to a ticket → `ticketId` set, `direction=outbound`, `source=admin`.
- Outbound attachment on a follow-up message → `threadMessageId` set (once that `ThreadMessage` exists), `direction=outbound`, `source=admin`.

Every admin has equal access to every ticket today (README: "No hay roles"), so attachment auth is just "is there a logged-in admin session", exactly like `FormImage`'s image route — no per-ticket ownership check needed.

### Storage

New module `src/lib/ticket-attachments.ts`, copying the shape of `form-uploads.ts`:

- `TICKET_ATTACHMENTS_ROOT` (env, default `/data/ticket-attachments`) — needs its own persistent Easypanel volume, same caveat as `FORM_UPLOADS_ROOT` in the README ("hay que marcar el volumen como persistente").
- `TICKET_ATTACHMENT_MAX_BYTES` (env, default `10485760` = 10MB per file).
- `TICKET_ATTACHMENT_MAX_FILES` (env, default `5` per message).
- `TICKET_ATTACHMENT_TOTAL_MAX_BYTES` (env, default `26214400` = 25MB per message — the common provider cap, e.g. Gmail), checked independently of the per-file cap rather than derived by multiplication.
- Allowed MIME (sniffed with `file-type`, same as forms — never trust the client-supplied extension/mime): `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/zip`.
- Files stored as `<ticketId-or-threadMessageId>/<uuid>.<ext>`, same random-name-on-disk approach as forms (the real filename is kept only in the DB row, for download).

### Endpoints (this app)

Admin-facing (session auth via `currentUser()`):
- `POST /api/attachments` — multipart, one file per call, body also carries `ticket_id` (staging an attachment before it's sent). Validates, stores on disk, creates a `TicketAttachment` row with `direction=outbound`, `source=admin`, `threadMessageId=null` (not yet linked to a sent message), returns `{ id, filename, mimeType, sizeBytes }`.
- `DELETE /api/attachments/[id]` — removes a *not-yet-sent* staged attachment (file + row), used by the "x" on a composer chip. Refuses to delete an attachment that is already linked to a sent ticket/thread message (immutable once sent, matching the audit-trail spirit of the rest of the app).
- `GET /api/attachments/[id]` — streams the file (`Content-Type` from the stored `mimeType`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, same as the forms image route). `Content-Disposition: inline` by default (so images/PDF open in a new tab like a normal "open attachment"); `?download=1` switches to `Content-Disposition: attachment` for an explicit download, replicating the two behaviours a normal webmail gives you.

n8n-facing (header auth via `X-N8N-Ingest-Token`, same secret as ticket ingest):
- `POST /api/n8n/tickets/[id]/attachments` — multipart, one or more `file` parts. Called by n8n right after `POST /api/n8n/tickets` for that same email, once per attachment n8n found on the inbound MIME message. Creates `TicketAttachment` rows with `direction=inbound`, `source=webmail`, `ticketId` = the path param. Returns `{ ok: true, attachments: [{ id, filename, mimeType, sizeBytes }] }`. Same size/type validation as the admin path (an inbound email can carry anything, so oversized/disallowed attachments are dropped with a per-file reason in the response rather than failing the whole call — losing one attachment shouldn't lose the ticket).

### Extending the send paths

Both `/api/tickets/[id]/send` and `/api/customers/[email]/thread/send` gain an `attachment_ids` field (repeated form field / JSON string array) referencing rows created by `POST /api/attachments` for that ticket. No change to their existing content-type handling — attachments are already on disk by the time the message is sent, so send only needs the ids, not the files.

At send time, the route:
1. Loads those `TicketAttachment` rows, rejects if any belong to a different ticket/customer (defence in depth).
2. Reads each file into a base64 string and adds it to the `SendApprovedPayload.attachments` sent to n8n (see contract below).
3. On success: for the ticket-approval route, the attachment rows already have the right `ticketId`/`direction=outbound` — nothing else to update. For the follow-up route, updates those rows' `threadMessageId` to the newly-created `ThreadMessage` id (they move from "staged, no message yet" to "attached to this sent message").
4. On failure (`result.ok === false`): leaves the attachments staged as-is, so the existing retry flow (edit and re-send a `send_failed` ticket) doesn't force a re-upload.

### n8n contract changes (external — not implemented in this repo)

**Outbound — `SendApprovedPayload` (POST body to `N8N_SEND_APPROVED_WEBHOOK_URL`) gains:**

```jsonc
{
  // ...existing fields unchanged...
  "attachments": [
    { "filename": "factura.pdf", "mime_type": "application/pdf", "content_base64": "..." }
  ]
}
```

The n8n workflow that sends the approved reply needs to read this array and attach each item (base64-decoded) to whatever node actually sends the mail (Gmail/SMTP node's binary/attachment input). If the array is empty/absent, behaviour is unchanged.

n8n's response should echo back what it actually attached, inside the existing `sent_message` object, so this app's audit log and Sent-folder copy match what really went out:

```jsonc
{
  "ok": true,
  "sent_message": {
    // ...existing fields...
    "attachments": [
      { "filename": "factura.pdf", "mime_type": "application/pdf", "size_bytes": 88213 }
    ]
  }
}
```

**Inbound — new step after `POST /api/n8n/tickets`:** for each attachment found on the source email, n8n calls `POST /api/n8n/tickets/{ticket_id}/attachments` (multipart, one file per part, same `X-N8N-Ingest-Token` header already used for ticket ingest). This is additive — existing behaviour (ingesting the ticket without attachments) keeps working unchanged if n8n isn't updated yet, it just won't show attachments for new emails.

### RFC822 sent-copy (`buildRfc822Message`)

Today it emits a top-level `multipart/alternative` (text + html). With attachments it needs to become a `multipart/mixed` envelope: the existing `multipart/alternative` part nested as the first part, followed by one part per attachment (`Content-Type: <mime>; name="..."`, `Content-Transfer-Encoding: base64`, `Content-Disposition: attachment; filename="..."`, base64 body wrapped at 76 columns). Signature changes to accept an optional `attachments: { filename, mimeType, contentBase64 }[]`; with an empty/absent array the output is byte-identical to today (no regression for the no-attachment case).

### UI

Composer (both the ticket-approval textarea and the follow-up textarea in `src/app/inbox-client.tsx`):
- A paperclip button next to the textarea opens a native multi-file picker.
- Each picked file is uploaded immediately to `POST /api/attachments` (staged), shown as a chip (filename, size, spinner while uploading, then a remove "×"). This mirrors how normal webmail clients attach files — the file is already sitting on the server by the time you hit Send, so Send just references the ids.
- Send is disabled while any chip is still uploading. On send, the composer includes the staged `attachment_ids` and clears the chip list on success (or keeps it on failure, matching point 4 above).

Thread view (message bubbles, same file):
- `ThreadMessageView` (`src/lib/thread-messages.ts`) gains an `attachments: { id, filename, mimeType, sizeBytes }[]` field, populated in `GET /api/customers/[email]/thread` by batching a `TicketAttachment` query across the page's ticket/thread-message ids (same shape as the existing `getTicketTags` batching).
- Each bubble that has attachments renders a small chip row underneath the text: an icon by mime type, filename, human-readable size, a "Ver" link (`GET /api/attachments/{id}` in a new tab — inline preview for images/PDF) and a "Descargar" link (`?download=1`). This covers "open a file from a received email" and "download/view inside the tool" for both directions.

Lower priority: the plain server-rendered `src/app/tickets/[id]/page.tsx` fallback view gets the same `<input type="file" multiple>` with `enctype="multipart/form-data"` added to its existing `<form>`, without the staged-chip UX (acceptable for a legacy/no-JS fallback page).

## Error Handling

- Client-side validation (extension hint) is advisory only; the server always re-checks real file type via `file-type`, mirroring `form-uploads.ts`.
- Per-file and per-message size/count limits return a specific error code (`file_too_large`, `unsupported_mime`, `too_many_files`, `total_size_exceeded`), surfaced in the composer as an inline error (existing `setError` pattern), not a silent drop.
- Inbound ingest (`/api/n8n/tickets/[id]/attachments`) is best-effort per file: one bad attachment returns a `skipped` entry with a reason instead of failing the whole call, so a ticket is never lost because of one attachment n8n couldn't push cleanly.
- If `sendApprovedReply` fails, staged outbound attachments are left untouched (not deleted, not orphan-cleaned) so the retry path works without re-uploading.
- Recommended follow-up (flagged, not built in this iteration): a scheduled cleanup script (same idea as `cleanup:expired-forms`) to delete outbound attachments that were staged and never sent after N days (ticket discarded, or simply stale), so disk usage doesn't grow unbounded from abandoned drafts.
- Recommended follow-up (flagged, not built in this iteration): antivirus/malware scanning before accepting an inbound attachment, since those come from customers with the widest allowed MIME set (zip/doc/xlsx included).

## Testing

- `src/lib/ticket-attachments.test.ts` (new): mirrors `form-uploads.test.ts` — mime sniffing/allowlist, per-file and total size limits, file count limit, storage path safety.
- `src/lib/webmail-sync.test.ts` (extend): `buildRfc822Message` with zero attachments stays byte-identical to today; with one/multiple attachments produces valid `multipart/mixed` with correctly base64-encoded, correctly bounded parts.
- `src/lib/thread-messages.test.ts` (extend): attachments array passes through `ticketToThreadMessages`/`storedThreadMessageToView` untouched.
- Route-level tests for the new endpoints following the existing pattern (`route.test.ts` next to a couple of the other API routes) covering: auth rejection (no session / wrong n8n token), oversized file, disallowed mime, and the happy path end to end.


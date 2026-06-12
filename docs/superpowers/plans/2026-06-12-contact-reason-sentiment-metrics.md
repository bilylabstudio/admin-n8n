# Contact Reason Sentiment Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add closed contact-reason and sentiment metrics to Review Admin without changing live n8n workflow behavior in this phase.

**Architecture:** Store optional routing and sentiment fields on `Ticket`, accept them through the existing n8n ingest endpoint, and expose period-scoped aggregates through the dashboard API. The dashboard UI reuses the existing KPI, percent bar, and panel patterns.

**Tech Stack:** Next.js App Router, Prisma, PostgreSQL, Vitest, TypeScript.

---

### Task 1: Database Fields

**Files:**
- Modify: `review-admin/prisma/schema.prisma`
- Create: `review-admin/prisma/migrations/20260612000000_add_ticket_reason_sentiment_metrics/migration.sql`

- [ ] **Step 1: Add nullable metric fields**

Add `routedTemplateId`, `routeSource`, `sentiment`, and `sentimentSource` to `Ticket`.

- [ ] **Step 2: Add read indexes**

Add indexes for `receivedAt`, `[routedTemplateId, receivedAt]`, `[routeSource, receivedAt]`, and `[sentiment, receivedAt]`.

- [ ] **Step 3: Create SQL migration**

Use `ALTER TABLE "Ticket" ADD COLUMN ... TEXT;` and matching `CREATE INDEX` statements.

### Task 2: Ticket Ingest

**Files:**
- Modify: `review-admin/src/lib/tickets.ts`
- Modify: `review-admin/src/lib/tickets.test.ts`

- [ ] **Step 1: Extend schema**

Accept `routed_template_id`, `route_source`, `sentiment`, and `sentiment_source` as optional payload fields.

- [ ] **Step 2: Persist safely**

Write metric fields on create. On update, only overwrite optional metrics when the incoming payload includes a non-empty value, so backfilled data is not erased by older n8n payloads.

- [ ] **Step 3: Add tests**

Verify metric fields are stored when present and absent metric fields are not sent in the update payload.

### Task 3: Template Labels

**Files:**
- Create: `review-admin/src/lib/template-labels.ts`

- [ ] **Step 1: Add canonical labels**

Map the current canonical router IDs to readable labels and families.

- [ ] **Step 2: Add resilient helpers**

Export `templateLabelFor`, `templateFamily`, and `FAMILY_LABELS` with prefix fallbacks for unknown future IDs.

### Task 4: Dashboard API

**Files:**
- Modify: `review-admin/src/app/api/dashboard/route.ts`

- [ ] **Step 1: Add aggregate queries**

Add `groupBy` queries for template ID, route source, sentiment, and sentiment crossed by template/category.

- [ ] **Step 2: Add response fields**

Return `reasonsByFamily`, `routeSourceBreakdown`, `closedLabelRate`, `sentimentBreakdown`, `sentimentCoverage`, and `sentimentByFamily`.

### Task 5: Dashboard UI

**Files:**
- Modify: `review-admin/src/app/dashboard/dashboard-client.tsx`
- Modify: `review-admin/src/app/globals.css`

- [ ] **Step 1: Extend data types**

Add the new API response fields to `DashboardData`.

- [ ] **Step 2: Render metrics**

Add sections for contact reasons, route source, sentiment, and sentiment by reason.

- [ ] **Step 3: Add compact CSS**

Add styles for reason rows and stacked sentiment bars using the existing dashboard visual language.

### Task 6: Verification

**Files:**
- Test command from `review-admin`: `npm.cmd test -- src/lib/tickets.test.ts`
- Type command from `review-admin`: `npm.cmd exec tsc -- --noEmit`

- [ ] **Step 1: Run focused tests**

Expected: ticket ingest tests pass.

- [ ] **Step 2: Generate Prisma client**

Run `npm.cmd run prisma:generate` if TypeScript needs the new Prisma fields.

- [ ] **Step 3: Run TypeScript**

Expected: no type errors from dashboard API/UI changes.

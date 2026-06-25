# API Marketing Spend KPIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Amazon Ads API spend ingestion and API-backed marketing KPIs to the sales dashboard.

**Architecture:** Store advertising spend in a new `PlatformMarketingSpend` table and keep it separate from payment/platform fees. Extend sales aggregation with marketing spend inputs and render MER / blended ROAS in the existing channel finance panel. Generate n8n workflow drafts that fetch Amazon Ads Sponsored Products reports and post normalized spend rows to Review Admin.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, Vitest, n8n workflow JSON, Amazon Ads API reporting.

---

### Task 1: Data Model And Ingest

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260625000000_add_platform_marketing_spend/migration.sql`
- Create: `src/lib/platform-marketing-spend.ts`
- Create: `src/lib/platform-marketing-spend.test.ts`
- Create: `src/app/api/n8n/marketing-spend/route.ts`

- [ ] Add the `PlatformMarketingSpend` Prisma model with provider/external record uniqueness and period indexes.
- [ ] Add a migration that creates the table, unique index, and lookup indexes.
- [ ] Add a Zod batch schema that normalizes numeric money fields to strings.
- [ ] Add an upsert helper keyed by `provider_externalRecordId`.
- [ ] Add a protected n8n ingest route using `verifyIngestToken`.
- [ ] Test schema parsing, empty batch rejection, and numeric normalization.

### Task 2: Sales Aggregation

**Files:**
- Modify: `src/lib/sales.ts`
- Modify: `src/lib/sales.test.ts`
- Modify: `src/app/api/sales/route.ts`

- [ ] Add marketing spend input types and KPIs.
- [ ] Compute total ad spend, ad spend rate, MER / blended ROAS, net after fees and ads, covered spend, and per-channel spend.
- [ ] Preserve zero-spend behavior by returning `null` for MER where no denominator exists.
- [ ] Load `PlatformMarketingSpend` in `/api/sales` using the same period/platform filters.
- [ ] Add tests for fees plus ads and for zero ad spend.

### Task 3: Sales Dashboard UI

**Files:**
- Modify: `src/app/ventas/sales-client.tsx`
- Modify: `src/app/globals.css`

- [ ] Extend the client data type with marketing KPIs and per-channel ad metrics.
- [ ] Rename the panel copy so it says fees and ads are API-backed.
- [ ] Add KPI cards for Amazon Ads spend, MER / blended ROAS, and net API after fees plus ads.
- [ ] Add per-channel columns for ad spend, MER, and net after fees plus ads.
- [ ] Keep the layout responsive with no wide overflow.

### Task 4: Amazon Ads n8n Workflow Drafts

**Files:**
- Create: `scripts/build-amazon-ads-workflows.cjs`
- Create: `workflows/amazon-ads-sync.json`
- Create: `workflows/amazon-ads-backfill-2026-temporal.json`

- [ ] Generate a scheduled sync workflow and a manual backfill workflow.
- [ ] Read settings from the existing n8n settings data table.
- [ ] Use Amazon Ads API reporting to create Sponsored Products daily campaign reports.
- [ ] Poll for completion, download GZIP JSON when needed, normalize campaign rows, and post to `/api/n8n/marketing-spend`.
- [ ] Update `PlatformSyncState` as `amazon_ads` / `amazon_ads_backfill_2026`.

### Task 5: Verification And Publish

**Files:**
- All modified files.

- [ ] Run targeted Vitest suites for sales, financial transactions, and marketing spend.
- [ ] Run TypeScript typecheck.
- [ ] Run workflow generator and inspect generated JSON.
- [ ] Commit Review Admin changes.
- [ ] Push the branch.


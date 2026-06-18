# Amazon Sales Status Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Amazon sales totals split by financial state so deferred Amazon transactions are visible without confusing them with released cash.

**Architecture:** Extend the existing `aggregate()` sales helper with a financial-status breakdown computed from the same `PlatformOrder` rows already used by `/api/sales`. Render the breakdown only when the sales view is filtered to Amazon, and keep the existing gross totals unchanged because deferred transactions are real Amazon sales.

**Tech Stack:** Next.js 14 app router, React client component, Prisma-backed API, Vitest unit tests.

---

### Task 1: Add Financial Status Aggregation

**Files:**
- Modify: `src/lib/sales.ts`
- Test: `src/lib/sales.test.ts`

- [ ] **Step 1: Add a failing test**

Add a test that calls `aggregate()` with Amazon orders in `paid`, `pending`, `partially_refunded`, and `refunded` states and expects `byFinancialStatus` to include order count, gross revenue, refunded revenue, net revenue, and units.

- [ ] **Step 2: Implement the aggregation**

Add a `SalesFinancialStatusBreakdown` type and include `byFinancialStatus` in the `SalesResponse` and `aggregate()` return value. Group by normalized `financialStatus`, round money values to two decimals, and sort common statuses in this order: `paid`, `pending`, `partially_refunded`, `refunded`, `voided`.

- [ ] **Step 3: Verify the unit test**

Run `npm.cmd exec vitest -- run --environment node src/lib/sales.test.ts`.

### Task 2: Render Amazon-Only Status Cards

**Files:**
- Modify: `src/app/ventas/sales-client.tsx`

- [ ] **Step 1: Extend client data types**

Add `byFinancialStatus` to the `SalesData` type with the same shape returned by the API.

- [ ] **Step 2: Add display helpers**

Add helpers to combine status rows and translate status labels. `pending` must display as `pendiente de liquidación` in the Amazon table.

- [ ] **Step 3: Add Amazon cards**

When `platform === 'amazon'`, render a compact row of KPI cards under the normal summary: `Liberado / pagado`, `Pendiente liquidación`, and `Reembolsos`.

### Task 3: Verify and Publish

**Files:**
- Modify: only the files above plus this plan.

- [ ] **Step 1: Run checks**

Run `npm.cmd exec vitest -- run --environment node src/lib/sales.test.ts` and `npm.cmd exec tsc -- --noEmit`.

- [ ] **Step 2: Commit scoped changes**

Commit only the sales files and this plan, leaving unrelated local changes untouched.

- [ ] **Step 3: Push current branch**

Run `git push` from `review-admin` so the deployment pipeline can pick up the dashboard changes.

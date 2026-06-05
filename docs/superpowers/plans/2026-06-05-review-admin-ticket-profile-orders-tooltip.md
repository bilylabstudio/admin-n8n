# Review Admin Ticket Order Tooltip Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a compact customer profile in inbound chat bubbles with email and a hover/focus tooltip for Shopify orders found by customer email.

**Architecture:** Add a focused server helper that reads `PlatformOrder` by normalized email, expose that profile through the existing customer thread API, and render a compact order-count tooltip in the existing `InboxClient` chat header. Keep formatting logic in a client-safe lib so it can be unit-tested without rendering React.

**Tech Stack:** Next.js 14 App Router, React 18, Prisma 5, PostgreSQL, Vitest, plain CSS.

---

## File Structure

- Modify: `prisma/schema.prisma`
  - Add a composite index for the new order lookup.
- Create: `prisma/migrations/20260605000000_add_platform_order_customer_email_processed_at_index/migration.sql`
  - Add the PostgreSQL index used by the local order lookup.
- Create: `src/lib/customer-profile.ts`
  - Server-only helper for loading order summaries by email.
- Create: `src/lib/customer-profile.test.ts`
  - Unit tests for email normalization, count, limit, fallback order number, and failure behavior.
- Create: `src/lib/customer-profile-view.ts`
  - Client-safe formatting helpers for labels, tooltip lines, currency, dates, and status labels.
- Create: `src/lib/customer-profile-view.test.ts`
  - Unit tests for singular/plural labels, order line formatting, status translation, fallback values, and cancelled orders.
- Modify: `src/app/api/customers/[email]/thread/route.ts`
  - Attach `customerProfile` to the existing thread response.
- Modify: `src/app/inbox-client.tsx`
  - Store the profile returned by the thread API and render the order-count tooltip in inbound bubbles.
- Modify: `src/app/globals.css`
  - Add compact tooltip styling that does not resize chat bubbles.
- Modify: `package.json`
  - Add the two new lib tests to the existing `npm.cmd test` command.

## Preconditions

The `review-admin` git worktree currently has unrelated local changes:

- `scripts/wipe-tickets.ts`
- `tsconfig.tsbuildinfo`

Do not stage, modify, or revert those files while implementing this plan.

---

### Task 1: Add PlatformOrder Lookup Index

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260605000000_add_platform_order_customer_email_processed_at_index/migration.sql`

- [ ] **Step 1: Add the Prisma schema index**

In `prisma/schema.prisma`, update the `PlatformOrder` model indexes from:

```prisma
  @@unique([platform, externalOrderId])
  @@index([platform, processedAt])
  @@index([processedAt])
```

to:

```prisma
  @@unique([platform, externalOrderId])
  @@index([platform, processedAt])
  @@index([processedAt])
  @@index([customerEmail, processedAt])
```

- [ ] **Step 2: Add the migration SQL**

Create `prisma/migrations/20260605000000_add_platform_order_customer_email_processed_at_index/migration.sql` with this exact content:

```sql
CREATE INDEX "PlatformOrder_customerEmail_processedAt_idx"
ON "PlatformOrder"("customerEmail", "processedAt");
```

- [ ] **Step 3: Validate Prisma schema**

Run:

```powershell
npm.cmd exec prisma validate
```

Expected: command exits with code 0 and prints that the Prisma schema is valid.

- [ ] **Step 4: Commit Task 1**

Run:

```powershell
git add prisma/schema.prisma prisma/migrations/20260605000000_add_platform_order_customer_email_processed_at_index/migration.sql
git commit -m "perf: index platform orders by customer email"
```

Expected: commit contains only the schema and migration files.

---

### Task 2: Add Server Customer Profile Helper

**Files:**
- Create: `src/lib/customer-profile.test.ts`
- Create: `src/lib/customer-profile.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/customer-profile.test.ts` with this exact content:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const count = vi.fn();
const findMany = vi.fn();

vi.mock('./db', () => ({
  db: {
    platformOrder: {
      count,
      findMany
    }
  }
}));

describe('getCustomerProfileByEmail', () => {
  beforeEach(() => {
    count.mockReset();
    findMany.mockReset();
  });

  it('returns an empty profile and skips db calls when email is blank', async () => {
    const { getCustomerProfileByEmail } = await import('./customer-profile');

    await expect(getCustomerProfileByEmail('   ')).resolves.toEqual({
      email: '',
      orderCount: 0,
      recentOrders: []
    });
    expect(count).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('normalizes email and returns total count plus five recent orders', async () => {
    const { getCustomerProfileByEmail } = await import('./customer-profile');
    count.mockResolvedValue(6);
    findMany.mockResolvedValue([
      {
        id: 'order-1',
        platform: 'shopify',
        orderNumber: '#1006',
        externalOrderId: '1006',
        processedAt: new Date('2026-06-04T10:00:00.000Z'),
        totalPrice: '49.90',
        currency: 'EUR',
        financialStatus: 'paid',
        fulfillmentStatus: 'fulfilled',
        cancelledAt: null
      }
    ]);

    await expect(getCustomerProfileByEmail(' Lola@Example.COM ')).resolves.toEqual({
      email: 'lola@example.com',
      orderCount: 6,
      recentOrders: [
        {
          id: 'order-1',
          platform: 'shopify',
          orderNumber: '#1006',
          processedAt: '2026-06-04T10:00:00.000Z',
          totalPrice: '49.90',
          currency: 'EUR',
          financialStatus: 'paid',
          fulfillmentStatus: 'fulfilled',
          cancelledAt: null
        }
      ]
    });

    expect(count).toHaveBeenCalledWith({
      where: {
        customerEmail: {
          equals: 'lola@example.com',
          mode: 'insensitive'
        }
      }
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        customerEmail: {
          equals: 'lola@example.com',
          mode: 'insensitive'
        }
      },
      orderBy: { processedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        platform: true,
        orderNumber: true,
        externalOrderId: true,
        processedAt: true,
        totalPrice: true,
        currency: true,
        financialStatus: true,
        fulfillmentStatus: true,
        cancelledAt: true
      }
    });
  });

  it('uses externalOrderId when orderNumber is missing', async () => {
    const { getCustomerProfileByEmail } = await import('./customer-profile');
    count.mockResolvedValue(1);
    findMany.mockResolvedValue([
      {
        id: 'order-2',
        platform: 'shopify',
        orderNumber: null,
        externalOrderId: '27215069513',
        processedAt: new Date('2026-06-02T08:30:00.000Z'),
        totalPrice: { toString: () => '29.95' },
        currency: 'EUR',
        financialStatus: 'pending',
        fulfillmentStatus: null,
        cancelledAt: null
      }
    ]);

    const profile = await getCustomerProfileByEmail('cliente@example.com');

    expect(profile.recentOrders[0].orderNumber).toBe('27215069513');
    expect(profile.recentOrders[0].totalPrice).toBe('29.95');
  });

  it('returns an empty profile when the order lookup fails', async () => {
    const { getCustomerProfileByEmail } = await import('./customer-profile');
    count.mockRejectedValue(new Error('database unavailable'));
    findMany.mockResolvedValue([]);

    await expect(getCustomerProfileByEmail('cliente@example.com')).resolves.toEqual({
      email: 'cliente@example.com',
      orderCount: 0,
      recentOrders: []
    });
  });
});
```

- [ ] **Step 2: Run the failing helper tests**

Run:

```powershell
npm.cmd exec vitest run --environment node src/lib/customer-profile.test.ts
```

Expected: FAIL because `src/lib/customer-profile.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/customer-profile.ts` with this exact content:

```ts
import { db } from './db';

const RECENT_ORDER_LIMIT = 5;

export type CustomerOrderSummary = {
  id: string;
  platform: string;
  orderNumber: string;
  processedAt: string;
  totalPrice: string;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
};

export type CustomerProfile = {
  email: string;
  orderCount: number;
  recentOrders: CustomerOrderSummary[];
};

type PlatformOrderRow = {
  id: string;
  platform: string;
  orderNumber: string | null;
  externalOrderId: string;
  processedAt: Date;
  totalPrice: unknown;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  cancelledAt: Date | null;
};

export async function getCustomerProfileByEmail(
  emailInput: string | null | undefined
): Promise<CustomerProfile> {
  const email = normalizeCustomerEmail(emailInput);
  if (!email) return emptyCustomerProfile('');

  try {
    const where = {
      customerEmail: {
        equals: email,
        mode: 'insensitive' as const
      }
    };

    const [orderCount, recentRows] = await Promise.all([
      db.platformOrder.count({ where }),
      db.platformOrder.findMany({
        where,
        orderBy: { processedAt: 'desc' },
        take: RECENT_ORDER_LIMIT,
        select: {
          id: true,
          platform: true,
          orderNumber: true,
          externalOrderId: true,
          processedAt: true,
          totalPrice: true,
          currency: true,
          financialStatus: true,
          fulfillmentStatus: true,
          cancelledAt: true
        }
      })
    ]);

    return {
      email,
      orderCount,
      recentOrders: recentRows.map(orderRowToSummary)
    };
  } catch {
    return emptyCustomerProfile(email);
  }
}

function normalizeCustomerEmail(emailInput: string | null | undefined) {
  return String(emailInput || '').trim().toLowerCase();
}

function emptyCustomerProfile(email: string): CustomerProfile {
  return {
    email,
    orderCount: 0,
    recentOrders: []
  };
}

function orderRowToSummary(row: PlatformOrderRow): CustomerOrderSummary {
  return {
    id: row.id,
    platform: row.platform,
    orderNumber: row.orderNumber || row.externalOrderId,
    processedAt: row.processedAt.toISOString(),
    totalPrice: decimalToString(row.totalPrice),
    currency: row.currency,
    financialStatus: row.financialStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    cancelledAt: row.cancelledAt?.toISOString() || null
  };
}

function decimalToString(value: unknown) {
  if (
    value &&
    typeof value === 'object' &&
    'toString' in value &&
    typeof (value as { toString: unknown }).toString === 'function'
  ) {
    return (value as { toString: () => string }).toString();
  }
  return String(value ?? '0');
}
```

- [ ] **Step 4: Run helper tests and typecheck this helper**

Run:

```powershell
npm.cmd exec vitest run --environment node src/lib/customer-profile.test.ts
npm.cmd exec tsc --noEmit
```

Expected: helper tests PASS. TypeScript exits with code 0.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add src/lib/customer-profile.ts src/lib/customer-profile.test.ts
git commit -m "feat: load customer order profile"
```

Expected: commit contains only the helper and its tests.

---

### Task 3: Expose Customer Profile Through Thread API

**Files:**
- Modify: `src/app/api/customers/[email]/thread/route.ts`

- [ ] **Step 1: Import the helper**

In `src/app/api/customers/[email]/thread/route.ts`, add this import below the existing `db` import:

```ts
import { getCustomerProfileByEmail } from '@/lib/customer-profile';
```

- [ ] **Step 2: Load profile alongside ticket queries**

Replace this block:

```ts
  const [selectedTicket, recentTickets] = await Promise.all([
    selectedTicketId
      ? db.ticket.findFirst({
          where: { id: selectedTicketId, customerEmail: email }
        })
      : null,
    db.ticket.findMany({
      where: { customerEmail: email },
      orderBy: { receivedAt: 'desc' },
      take: limit
    })
  ]);
```

with:

```ts
  const [selectedTicket, recentTickets, customerProfile] = await Promise.all([
    selectedTicketId
      ? db.ticket.findFirst({
          where: { id: selectedTicketId, customerEmail: email }
        })
      : null,
    db.ticket.findMany({
      where: { customerEmail: email },
      orderBy: { receivedAt: 'desc' },
      take: limit
    }),
    getCustomerProfileByEmail(email)
  ]);
```

- [ ] **Step 3: Add profile to the JSON response**

In the `NextResponse.json({ ... })` object, add `customerProfile` immediately after `customerName`:

```ts
    customerEmail: email,
    customerName: anchorTicket?.customerName || storedMessages[0]?.customerName || null,
    customerProfile,
    subject: anchorTicket?.subject || storedMessages[0]?.subject || '(sin asunto)',
```

- [ ] **Step 4: Run focused checks**

Run:

```powershell
npm.cmd exec tsc --noEmit
```

Expected: TypeScript exits with code 0.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add "src/app/api/customers/[email]/thread/route.ts"
git commit -m "feat: include customer profile in thread api"
```

Expected: commit contains only the thread route change.

---

### Task 4: Add Client-Safe Order Formatting Helpers

**Files:**
- Create: `src/lib/customer-profile-view.test.ts`
- Create: `src/lib/customer-profile-view.ts`

- [ ] **Step 1: Write failing view-helper tests**

Create `src/lib/customer-profile-view.test.ts` with this exact content:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatCustomerOrderLine,
  formatOrderCountLabel,
  paymentStatusLabel,
  fulfillmentStatusLabel
} from './customer-profile-view';

describe('customer profile view helpers', () => {
  it('formats singular and plural order count labels', () => {
    expect(formatOrderCountLabel(1)).toBe('1 pedido encontrado');
    expect(formatOrderCountLabel(3)).toBe('3 pedidos encontrados');
  });

  it('formats a full order line for the tooltip', () => {
    expect(
      formatCustomerOrderLine({
        id: 'order-1',
        platform: 'shopify',
        orderNumber: '#27215069513',
        processedAt: '2026-06-02T08:30:00.000Z',
        totalPrice: '49.9',
        currency: 'EUR',
        financialStatus: 'paid',
        fulfillmentStatus: 'fulfilled',
        cancelledAt: null
      })
    ).toBe('#27215069513 - 02/06/2026 - 49,90 EUR - pagado - enviado');
  });

  it('falls back when date, amount, or order number are incomplete', () => {
    expect(
      formatCustomerOrderLine({
        id: 'fallback-id',
        platform: 'shopify',
        orderNumber: '',
        processedAt: 'not-a-date',
        totalPrice: 'not-a-number',
        currency: 'EUR',
        financialStatus: '',
        fulfillmentStatus: null,
        cancelledAt: null
      })
    ).toBe('#fallback-id - fecha sin datos - not-a-number EUR - pago sin datos - sin envio');
  });

  it('marks cancelled orders in the fulfillment slot', () => {
    expect(
      fulfillmentStatusLabel({
        fulfillmentStatus: 'fulfilled',
        cancelledAt: '2026-06-03T00:00:00.000Z'
      })
    ).toBe('cancelado');
  });

  it('translates common payment and fulfillment statuses', () => {
    expect(paymentStatusLabel('paid')).toBe('pagado');
    expect(paymentStatusLabel('pending')).toBe('pendiente');
    expect(paymentStatusLabel('refunded')).toBe('reembolsado');
    expect(fulfillmentStatusLabel({ fulfillmentStatus: 'partial', cancelledAt: null })).toBe('parcial');
    expect(fulfillmentStatusLabel({ fulfillmentStatus: 'fulfilled', cancelledAt: null })).toBe('enviado');
  });
});
```

- [ ] **Step 2: Run the failing view-helper tests**

Run:

```powershell
npm.cmd exec vitest run --environment node src/lib/customer-profile-view.test.ts
```

Expected: FAIL because `src/lib/customer-profile-view.ts` does not exist.

- [ ] **Step 3: Implement view helpers**

Create `src/lib/customer-profile-view.ts` with this exact content:

```ts
export type CustomerOrderSummaryView = {
  id: string;
  platform: string;
  orderNumber: string;
  processedAt: string;
  totalPrice: string;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
};

export type CustomerProfileView = {
  email: string;
  orderCount: number;
  recentOrders: CustomerOrderSummaryView[];
};

const PAYMENT_LABELS: Record<string, string> = {
  paid: 'pagado',
  pending: 'pendiente',
  refunded: 'reembolsado',
  partially_refunded: 'reembolso parcial',
  authorized: 'autorizado',
  voided: 'anulado'
};

const FULFILLMENT_LABELS: Record<string, string> = {
  fulfilled: 'enviado',
  partial: 'parcial',
  restocked: 'devuelto a stock',
  unfulfilled: 'sin envio'
};

export function formatOrderCountLabel(orderCount: number) {
  return orderCount === 1 ? '1 pedido encontrado' : `${orderCount} pedidos encontrados`;
}

export function formatCustomerOrderLine(order: CustomerOrderSummaryView) {
  return [
    formatOrderNumber(order),
    formatOrderDate(order.processedAt),
    formatOrderAmount(order.totalPrice, order.currency),
    paymentStatusLabel(order.financialStatus),
    fulfillmentStatusLabel(order)
  ].join(' - ');
}

export function paymentStatusLabel(status: string | null | undefined) {
  const key = String(status || '').trim().toLowerCase();
  if (!key) return 'pago sin datos';
  return PAYMENT_LABELS[key] || key.replace(/_/g, ' ');
}

export function fulfillmentStatusLabel(order: {
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
}) {
  if (order.cancelledAt) return 'cancelado';
  const key = String(order.fulfillmentStatus || '').trim().toLowerCase();
  if (!key) return 'sin envio';
  return FULFILLMENT_LABELS[key] || key.replace(/_/g, ' ');
}

function formatOrderNumber(order: CustomerOrderSummaryView) {
  const value = String(order.orderNumber || order.id || '').trim();
  if (!value) return '#sin-numero';
  return value.startsWith('#') ? value : `#${value}`;
}

function formatOrderDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'fecha sin datos';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatOrderAmount(value: string, currency: string) {
  const amount = Number(value);
  const cleanCurrency = String(currency || 'EUR').trim() || 'EUR';
  if (!Number.isFinite(amount)) return `${value} ${cleanCurrency}`;
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: cleanCurrency,
    currencyDisplay: 'code'
  })
    .format(amount)
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Run view-helper tests**

Run:

```powershell
npm.cmd exec vitest run --environment node src/lib/customer-profile-view.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```powershell
git add src/lib/customer-profile-view.ts src/lib/customer-profile-view.test.ts
git commit -m "feat: format customer order tooltip"
```

Expected: commit contains only the view helper and its tests.

---

### Task 5: Render Order Tooltip In Conversation Bubbles

**Files:**
- Modify: `src/app/inbox-client.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Import profile view helpers**

In `src/app/inbox-client.tsx`, add this import after the React import block:

```ts
import {
  formatCustomerOrderLine,
  formatOrderCountLabel,
  type CustomerProfileView
} from '@/lib/customer-profile-view';
```

- [ ] **Step 2: Add thread response profile type**

In `src/app/inbox-client.tsx`, add this constant after `type ThreadResponse` or before `const POLL_MS`:

```ts
const EMPTY_CUSTOMER_PROFILE: CustomerProfileView = {
  email: '',
  orderCount: 0,
  recentOrders: []
};
```

Update `type ThreadResponse` from:

```ts
type ThreadResponse = {
  ok: boolean;
  customerEmail: string;
  customerName: string | null;
  subject: string;
  anchorTicketId: string | null;
  pendingTicketId: string | null;
  composerMode: 'review_ticket' | 'follow_up';
  draft: string;
  messages: ThreadMessage[];
  error?: string;
};
```

to:

```ts
type ThreadResponse = {
  ok: boolean;
  customerEmail: string;
  customerName: string | null;
  customerProfile?: CustomerProfileView;
  subject: string;
  anchorTicketId: string | null;
  pendingTicketId: string | null;
  composerMode: 'review_ticket' | 'follow_up';
  draft: string;
  messages: ThreadMessage[];
  error?: string;
};
```

- [ ] **Step 3: Store and reset customer profile state**

Inside `InboxClient`, add this state near the existing thread state:

```ts
  const [customerProfile, setCustomerProfile] = useState<CustomerProfileView>(
    EMPTY_CUSTOMER_PROFILE
  );
```

In `loadConversation`, after `setThreadCustomerName(fixMojibake(data.customerName));`, add:

```ts
        setCustomerProfile(fixCustomerProfile(data.customerProfile));
```

In `switchViewMode`, after `setThreadAnchorTicketId(null);`, add:

```ts
    setCustomerProfile(EMPTY_CUSTOMER_PROFILE);
```

- [ ] **Step 4: Pass profile into ThreadPane**

In the `<ThreadPane ... />` call, add:

```tsx
            customerProfile={customerProfile}
```

Update the `ThreadPane` function signature to include `customerProfile`:

```tsx
function ThreadPane({
  anchorTicketId,
  composerMode,
  customerEmail,
  customerName,
  customerProfile,
  dirty,
  draft,
  loading,
  messages,
  onBack,
  onDraftChange,
  onSubmitFollowUp,
  onSubmitReview,
  pendingTicketId,
  selectedTicket,
  submitting
}: {
  anchorTicketId: string | null;
  composerMode: ThreadResponse['composerMode'];
  customerEmail: string | null;
  customerName: string | null;
  customerProfile: CustomerProfileView;
  dirty: boolean;
  draft: string;
  loading: boolean;
  messages: ThreadMessage[];
  onBack: () => void;
  onDraftChange: (value: string) => void;
  onSubmitFollowUp: () => void;
  onSubmitReview: (action: SubmitAction, ticketId?: string) => void;
  pendingTicketId: string | null;
  selectedTicket: Ticket | null;
  submitting: string | null;
}) {
```

- [ ] **Step 5: Render compact customer metadata in inbound bubbles**

Inside `ThreadPane`, replace this inbound header block:

```tsx
                  <span className="bubble-who">
                    {isInbound ? customerName || 'Cliente' : 'Susana'} - {formatDate(message.at)}
                    {message.status ? <> - <StatusBadge status={message.status} /></> : null}
                    {!isInbound && message.source === 'webmail' ? <> - Webmail</> : null}
                  </span>
```

with:

```tsx
                  {isInbound ? (
                    <CustomerBubbleMeta
                      at={message.at}
                      customerEmail={customerEmail}
                      customerName={customerName}
                      profile={customerProfile}
                      status={message.status}
                    />
                  ) : (
                    <span className="bubble-who">
                      Susana - {formatDate(message.at)}
                      {message.status ? <> - <StatusBadge status={message.status} /></> : null}
                      {message.source === 'webmail' ? <> - Webmail</> : null}
                    </span>
                  )}
```

- [ ] **Step 6: Add customer tooltip component**

Add this component before `function CopyButton`:

```tsx
function CustomerBubbleMeta({
  at,
  customerEmail,
  customerName,
  profile,
  status
}: {
  at: string;
  customerEmail: string | null;
  customerName: string | null;
  profile: CustomerProfileView;
  status: TicketStatus | null;
}) {
  const hasOrders = profile.orderCount > 0 && profile.recentOrders.length > 0;
  return (
    <span className="bubble-who customer-bubble-meta">
      <span>{customerName || 'Cliente'}</span>
      {customerEmail ? (
        <>
          <span aria-hidden="true">-</span>
          <span>{customerEmail}</span>
        </>
      ) : null}
      <span aria-hidden="true">-</span>
      <time>{formatDate(at)}</time>
      {status ? (
        <>
          <span aria-hidden="true">-</span>
          <StatusBadge status={status} />
        </>
      ) : null}
      {hasOrders ? (
        <>
          <span aria-hidden="true">-</span>
          <span className="order-tooltip-wrap">
            <button
              aria-label={`${formatOrderCountLabel(profile.orderCount)}. Ver ultimos pedidos`}
              className="order-count-trigger"
              type="button"
            >
              {formatOrderCountLabel(profile.orderCount)}
            </button>
            <span className="order-tooltip" role="tooltip">
              {profile.recentOrders.map((order) => (
                <span className="order-tooltip-line" key={order.id}>
                  {formatCustomerOrderLine(order)}
                </span>
              ))}
            </span>
          </span>
        </>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 7: Add customer profile sanitizer**

At the bottom of `src/app/inbox-client.tsx`, after `fixThreadMessage`, add:

```ts
function fixCustomerProfile(profile?: CustomerProfileView | null): CustomerProfileView {
  if (!profile) return EMPTY_CUSTOMER_PROFILE;
  return {
    email: profile.email || '',
    orderCount: Number(profile.orderCount || 0),
    recentOrders: Array.isArray(profile.recentOrders)
      ? profile.recentOrders.map((order) => ({
          id: String(order.id || ''),
          platform: String(order.platform || ''),
          orderNumber: String(order.orderNumber || ''),
          processedAt: String(order.processedAt || ''),
          totalPrice: String(order.totalPrice || '0'),
          currency: String(order.currency || 'EUR'),
          financialStatus: String(order.financialStatus || ''),
          fulfillmentStatus: order.fulfillmentStatus ? String(order.fulfillmentStatus) : null,
          cancelledAt: order.cancelledAt ? String(order.cancelledAt) : null
        }))
      : []
  };
}
```

- [ ] **Step 8: Add tooltip CSS**

In `src/app/globals.css`, after the `.bubble-who` rule, add:

```css
.customer-bubble-meta {
  flex-wrap: wrap;
  row-gap: 3px;
}

.order-tooltip-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.order-count-trigger {
  border: 0;
  background: transparent;
  color: var(--gummy-teal);
  padding: 0;
  font: inherit;
  font-weight: 800;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

.order-count-trigger:hover,
.order-count-trigger:focus-visible {
  color: #347d83;
  outline: none;
}

.order-tooltip {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 30;
  width: max-content;
  max-width: min(430px, calc(100vw - 32px));
  display: none;
  gap: 5px;
  border: 1px solid rgba(46, 42, 57, 0.16);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--ink-soft);
  padding: 9px 10px;
  box-shadow: 0 10px 28px rgba(46, 42, 57, 0.14);
  white-space: normal;
}

.order-tooltip-wrap:hover .order-tooltip,
.order-tooltip-wrap:focus-within .order-tooltip {
  display: grid;
}

.order-tooltip-line {
  display: block;
  min-width: 0;
  font-size: 12px;
  line-height: 1.35;
}
```

Inside the existing `@media (max-width: 680px)` block, after `.thread-bubble { max-width: 100%; }`, add:

```css
  .order-tooltip {
    left: auto;
    right: 0;
    max-width: calc(100vw - 32px);
  }
```

- [ ] **Step 9: Run typecheck**

Run:

```powershell
npm.cmd exec tsc --noEmit
```

Expected: TypeScript exits with code 0.

- [ ] **Step 10: Commit Task 5**

Run:

```powershell
git add src/app/inbox-client.tsx src/app/globals.css
git commit -m "feat: show order tooltip in customer bubbles"
```

Expected: commit contains only UI and CSS changes.

---

### Task 6: Add New Tests To Project Test Script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update npm test script**

In `package.json`, replace the existing `"test"` script value with:

```json
"test": "vitest run --environment node src/lib/status.test.ts src/lib/auth.test.ts src/lib/forms.test.ts src/lib/form-uploads.test.ts src/lib/return-form-fields.test.ts src/lib/sales.test.ts src/lib/tickets.test.ts src/lib/webmail-sync.test.ts src/lib/ticket-tags.test.ts src/lib/customer-profile.test.ts src/lib/customer-profile-view.test.ts"
```

- [ ] **Step 2: Run full tests**

Run:

```powershell
npm.cmd test
```

Expected: all listed Vitest files PASS.

- [ ] **Step 3: Commit Task 6**

Run:

```powershell
git add package.json
git commit -m "test: include customer profile tests"
```

Expected: commit contains only `package.json`.

---

### Task 7: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run Prisma validation**

Run:

```powershell
npm.cmd exec prisma validate
```

Expected: schema validates successfully.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm.cmd test
```

Expected: all Vitest tests PASS.

- [ ] **Step 3: Run TypeScript check**

Run:

```powershell
npm.cmd exec tsc --noEmit
```

Expected: TypeScript exits with code 0.

- [ ] **Step 4: Build the app**

Run:

```powershell
npm.cmd run build
```

Expected: Prisma generate and Next build complete successfully.

- [ ] **Step 5: Manual UI validation**

Run the dev server:

```powershell
npm.cmd run dev
```

Open the Review Admin inbox, select a customer with synced Shopify orders, and verify:

- Inbound bubble header shows customer name.
- Inbound bubble header shows customer email.
- Inbound bubble header shows `N pedidos encontrados`.
- Hovering the order text shows up to 5 recent orders.
- Focusing the order text with keyboard shows the same tooltip.
- Customer without orders has no extra order text.
- Sending, rejecting, and follow-up composer controls still work.
- Mobile-width viewport keeps the tooltip inside the screen.

- [ ] **Step 6: Final status check**

Run:

```powershell
git status --short
```

Expected: only the pre-existing unrelated files remain dirty, or the working tree is clean if those unrelated files were handled by the user.

---

## Self-Review

**Spec coverage:**

- Orders are loaded by `customerEmail` from local `PlatformOrder`: Task 2 and Task 3.
- No live Shopify call is added: all tasks use local database and existing API only.
- Header shows name, email, and order count: Task 5.
- Tooltip shows up to 5 recent orders: Task 2 caps data at 5, Task 5 renders the tooltip.
- Tooltip fields include number, date, total, payment, and fulfillment: Task 4.
- No extra UI appears when no orders exist: Task 5 checks `profile.orderCount > 0 && profile.recentOrders.length > 0`.
- Conversation remains usable if order lookup fails: Task 2 returns an empty profile on lookup failure.
- Mobile/focus support: Task 5 uses a focusable button and CSS `:focus-within`.
- Tests cover helper and formatting behavior: Task 2 and Task 4.

**Placeholder scan:**

- No `TODO`, `TBD`, or open implementation placeholders are present.
- Every file creation includes exact code.
- Every command includes expected outcome.

**Type consistency:**

- Server type `CustomerProfile` and client type `CustomerProfileView` share the same JSON shape.
- API property is consistently named `customerProfile`.
- UI state, prop, sanitizer, and formatter all use `CustomerProfileView`.

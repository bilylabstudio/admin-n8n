# Review Admin Order Number Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the customer order tooltip lookup so tickets with an explicit order number such as `#45405` find the matching `PlatformOrder` even when the ticket email does not match the purchase email.

**Architecture:** Keep the existing tooltip UI unchanged. Extend `src/lib/customer-profile.ts` with conservative order-number extraction and a new `getCustomerProfile({ email, texts })` lookup that combines email matches with order-number matches, dedupes by order id, and keeps the existing `getCustomerProfileByEmail(email)` wrapper. Update the customer thread API to pass recent ticket text into the helper.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma 5, PostgreSQL, Vitest.

---

## File Structure

- Modify: `src/lib/customer-profile.ts`
  - Add extraction helpers and combined email/order-number lookup.
- Modify: `src/lib/customer-profile.test.ts`
  - Add tests for extraction, order-number lookup, dedupe, and limit behavior.
- Modify: `src/app/api/customers/[email]/thread/route.ts`
  - Pass selected/recent ticket subject and body text into the profile helper.

## Preconditions

The `review-admin` worktree may contain unrelated local files:

- `scripts/wipe-tickets.ts`
- `tsconfig.tsbuildinfo`

Do not stage, modify, or revert those files while executing this plan.

---

### Task 1: Add Failing Tests For Order Number Extraction

**Files:**
- Modify: `src/lib/customer-profile.test.ts`

- [ ] **Step 1: Add extraction tests**

In `src/lib/customer-profile.test.ts`, after the existing imports and mock setup, add this new `describe` block before `describe('getCustomerProfileByEmail', ...)`:

```ts
describe('extractOrderNumberCandidates', () => {
  it('extracts hash-prefixed order numbers', async () => {
    const { extractOrderNumberCandidates } = await import('./customer-profile');

    expect(
      extractOrderNumberCandidates([
        'Hola soy Isabel y he realizado el pedido #45405 y necesito modificar la direccion.'
      ])
    ).toEqual(['45405']);
  });

  it('extracts numbers near order words', async () => {
    const { extractOrderNumberCandidates } = await import('./customer-profile');

    expect(
      extractOrderNumberCandidates([
        'Necesito revisar pedido 45405',
        'La orden 99881 no aparece',
        'My order 77777 has a problem',
        'Compra 11223 pendiente'
      ])
    ).toEqual(['45405', '99881', '77777', '11223']);
  });

  it('does not extract address, postal code, or short numbers without order context', async () => {
    const { extractOrderNumberCandidates } = await import('./customer-profile');

    expect(
      extractOrderNumberCandidates([
        'Nueva direccion Calle Valle de Zuriza numero 20, 3B, 50015 Zaragoza'
      ])
    ).toEqual([]);
  });

  it('dedupes candidates and strips punctuation', async () => {
    const { extractOrderNumberCandidates } = await import('./customer-profile');

    expect(
      extractOrderNumberCandidates([
        'Pedido #45405.',
        'pedido 45405',
        'orden: #45405'
      ])
    ).toEqual(['45405']);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm.cmd exec vitest run --environment node src/lib/customer-profile.test.ts
```

Expected: FAIL because `extractOrderNumberCandidates` is not exported yet.

- [ ] **Step 3: Commit nothing**

Do not commit after this task. These failing tests are completed by Task 2.

---

### Task 2: Implement Conservative Order Number Extraction

**Files:**
- Modify: `src/lib/customer-profile.ts`
- Test: `src/lib/customer-profile.test.ts`

- [ ] **Step 1: Add extraction constants and function**

In `src/lib/customer-profile.ts`, after `const RECENT_ORDER_LIMIT = 5;`, add:

```ts
const ORDER_LOOKUP_LIMIT = 25;
const ORDER_NUMBER_MIN_LENGTH = 4;
const ORDER_WORD_PATTERN = '(?:pedido|orden|order|compra|subscription|suscripcion)';
const HASH_ORDER_RE = /#\s*([A-Za-z0-9][A-Za-z0-9._-]{3,})/gi;
const WORD_ORDER_RE = new RegExp(
  `${ORDER_WORD_PATTERN}\\s*(?:n(?:umero|ro|o)?\\.?|number|#|:|-)?\\s*#?\\s*([A-Za-z0-9][A-Za-z0-9._-]{3,})`,
  'gi'
);
```

Then add this exported function after the type declarations:

```ts
export function extractOrderNumberCandidates(texts: Array<string | null | undefined>) {
  const candidates = new Set<string>();

  for (const text of texts) {
    const value = String(text || '');
    collectMatches(value, HASH_ORDER_RE, candidates);
    collectMatches(value, WORD_ORDER_RE, candidates);
  }

  return [...candidates];
}
```

Add these helper functions near the bottom of the file before `decimalToString`:

```ts
function collectMatches(value: string, pattern: RegExp, candidates: Set<string>) {
  pattern.lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const candidate = normalizeOrderCandidate(match[1]);
    if (candidate) candidates.add(candidate);
  }
}

function normalizeOrderCandidate(value: string | undefined) {
  const candidate = String(value || '')
    .trim()
    .replace(/^#+/, '')
    .replace(/[.,;:)\]]+$/g, '')
    .replace(/\s+/g, '');

  if (candidate.length < ORDER_NUMBER_MIN_LENGTH) return '';
  if (!/[0-9]/.test(candidate)) return '';
  return candidate;
}
```

- [ ] **Step 2: Run extraction tests**

Run:

```powershell
npm.cmd exec vitest run --environment node src/lib/customer-profile.test.ts
```

Expected: all existing tests and new extraction tests PASS.

- [ ] **Step 3: Commit Task 2**

Run:

```powershell
git add src/lib/customer-profile.ts src/lib/customer-profile.test.ts
git commit -m "feat: extract order numbers from ticket text"
```

Expected: commit contains only the helper and test file.

---

### Task 3: Add Combined Email And Order Number Lookup

**Files:**
- Modify: `src/lib/customer-profile.test.ts`
- Modify: `src/lib/customer-profile.ts`

- [ ] **Step 1: Replace the db mock declarations in the test**

At the top of `src/lib/customer-profile.test.ts`, keep:

```ts
const count = vi.fn();
const findMany = vi.fn();
```

The existing mock remains valid:

```ts
vi.mock('./db', () => ({
  db: {
    platformOrder: {
      count,
      findMany
    }
  }
}));
```

- [ ] **Step 2: Add combined lookup tests**

Inside `describe('getCustomerProfileByEmail', ...)`, after the existing tests, add:

```ts
  it('finds an order by number when the email does not match', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    count.mockResolvedValue(0);
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'order-by-number',
          platform: 'shopify',
          orderNumber: '#45405',
          externalOrderId: 'gid-45405',
          processedAt: new Date('2026-06-05T09:00:00.000Z'),
          totalPrice: '59.90',
          currency: 'EUR',
          financialStatus: 'paid',
          fulfillmentStatus: 'fulfilled',
          cancelledAt: null
        }
      ]);

    await expect(
      getCustomerProfile({
        email: 'ticket-email@example.com',
        texts: ['Modificar direccion de envio', 'He realizado el pedido #45405']
      })
    ).resolves.toEqual({
      email: 'ticket-email@example.com',
      orderCount: 1,
      recentOrders: [
        {
          id: 'order-by-number',
          platform: 'shopify',
          orderNumber: '#45405',
          processedAt: '2026-06-05T09:00:00.000Z',
          totalPrice: '59.90',
          currency: 'EUR',
          financialStatus: 'paid',
          fulfillmentStatus: 'fulfilled',
          cancelledAt: null
        }
      ]
    });

    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          OR: [
            { orderNumber: { in: ['45405', '#45405'] } },
            { externalOrderId: { in: ['45405'] } }
          ]
        }
      })
    );
  });

  it('dedupes orders found by both email and number and prioritizes number matches', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    count.mockResolvedValue(2);
    const shared = {
      id: 'shared-order',
      platform: 'shopify',
      orderNumber: '#45405',
      externalOrderId: '45405',
      processedAt: new Date('2026-06-05T09:00:00.000Z'),
      totalPrice: '59.90',
      currency: 'EUR',
      financialStatus: 'paid',
      fulfillmentStatus: 'fulfilled',
      cancelledAt: null
    };
    findMany
      .mockResolvedValueOnce([
        {
          id: 'email-order',
          platform: 'shopify',
          orderNumber: '#1001',
          externalOrderId: '1001',
          processedAt: new Date('2026-06-01T09:00:00.000Z'),
          totalPrice: '29.90',
          currency: 'EUR',
          financialStatus: 'paid',
          fulfillmentStatus: null,
          cancelledAt: null
        },
        shared
      ])
      .mockResolvedValueOnce([shared]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['pedido #45405']
    });

    expect(profile.orderCount).toBe(2);
    expect(profile.recentOrders.map((order) => order.id)).toEqual([
      'shared-order',
      'email-order'
    ]);
  });

  it('keeps only five recent deduped orders', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    count.mockResolvedValue(6);
    findMany
      .mockResolvedValueOnce(
        Array.from({ length: 6 }, (_, index) => ({
          id: `email-order-${index}`,
          platform: 'shopify',
          orderNumber: `#10${index}`,
          externalOrderId: `10${index}`,
          processedAt: new Date(`2026-06-0${Math.min(index + 1, 9)}T09:00:00.000Z`),
          totalPrice: '10.00',
          currency: 'EUR',
          financialStatus: 'paid',
          fulfillmentStatus: null,
          cancelledAt: null
        }))
      )
      .mockResolvedValueOnce([]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['pedido #99999']
    });

    expect(profile.orderCount).toBe(6);
    expect(profile.recentOrders).toHaveLength(5);
  });
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```powershell
npm.cmd exec vitest run --environment node src/lib/customer-profile.test.ts
```

Expected: FAIL because `getCustomerProfile` does not exist or does not perform order-number lookup yet.

- [ ] **Step 4: Implement lookup types and functions**

In `src/lib/customer-profile.ts`, add this type after `CustomerProfile`:

```ts
export type CustomerProfileLookupInput = {
  email: string | null | undefined;
  texts?: Array<string | null | undefined>;
};
```

Replace `getCustomerProfileByEmail` with this wrapper plus the new function:

```ts
export async function getCustomerProfileByEmail(
  emailInput: string | null | undefined
): Promise<CustomerProfile> {
  return getCustomerProfile({ email: emailInput });
}

export async function getCustomerProfile(
  input: CustomerProfileLookupInput
): Promise<CustomerProfile> {
  const email = normalizeCustomerEmail(input.email);
  const orderNumbers = extractOrderNumberCandidates(input.texts || []);
  if (!email && !orderNumbers.length) return emptyCustomerProfile('');

  try {
    const [emailRows, numberRows] = await Promise.all([
      email ? findOrdersByEmail(email) : Promise.resolve([]),
      orderNumbers.length ? findOrdersByOrderNumbers(orderNumbers) : Promise.resolve([])
    ]);

    const orderedRows = dedupeOrders([...numberRows, ...emailRows]);

    return {
      email,
      orderCount: orderedRows.length,
      recentOrders: orderedRows.slice(0, RECENT_ORDER_LIMIT).map(orderRowToSummary)
    };
  } catch {
    return emptyCustomerProfile(email);
  }
}
```

Add these helper functions before `normalizeCustomerEmail`:

```ts
async function findOrdersByEmail(email: string): Promise<PlatformOrderRow[]> {
  return db.platformOrder.findMany({
    where: {
      customerEmail: {
        equals: email,
        mode: 'insensitive'
      }
    },
    orderBy: { processedAt: 'desc' },
    take: ORDER_LOOKUP_LIMIT,
    select: platformOrderSelect()
  });
}

async function findOrdersByOrderNumbers(orderNumbers: string[]): Promise<PlatformOrderRow[]> {
  const orderNumberVariants = Array.from(
    new Set(orderNumbers.flatMap((number) => [number, `#${number}`]))
  );

  return db.platformOrder.findMany({
    where: {
      OR: [
        { orderNumber: { in: orderNumberVariants } },
        { externalOrderId: { in: orderNumbers } }
      ]
    },
    orderBy: { processedAt: 'desc' },
    take: ORDER_LOOKUP_LIMIT,
    select: platformOrderSelect()
  });
}

function platformOrderSelect() {
  return {
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
  };
}

function dedupeOrders(rows: PlatformOrderRow[]) {
  const seen = new Set<string>();
  const result: PlatformOrderRow[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }

  return result.sort((a, b) => b.processedAt.getTime() - a.processedAt.getTime());
}
```

- [ ] **Step 5: Remove the old count-based implementation**

Delete the old inline `count` + `findMany` implementation from `getCustomerProfileByEmail`; the wrapper now delegates to `getCustomerProfile`.

- [ ] **Step 6: Update legacy test expectations if needed**

The existing email-only test currently expects `count` to be called. After moving away from `count`, update that test to assert only the email `findMany` call:

```ts
expect(count).not.toHaveBeenCalled();
expect(findMany).toHaveBeenCalledWith(
  expect.objectContaining({
    where: {
      customerEmail: {
        equals: 'lola@example.com',
        mode: 'insensitive'
      }
    },
    orderBy: { processedAt: 'desc' },
    take: 25
  })
);
```

Also keep the expected `orderCount: 1` for that test, because `orderCount` is now the deduped total returned by local rows, not a separate count query.

- [ ] **Step 7: Run helper tests**

Run:

```powershell
npm.cmd exec vitest run --environment node src/lib/customer-profile.test.ts
```

Expected: all helper tests PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```powershell
git add src/lib/customer-profile.ts src/lib/customer-profile.test.ts
git commit -m "feat: match customer profile orders by number"
```

Expected: commit contains only the helper and test file.

---

### Task 4: Pass Ticket Text Into Customer Profile Lookup

**Files:**
- Modify: `src/app/api/customers/[email]/thread/route.ts`

- [ ] **Step 1: Update import**

Change:

```ts
import { getCustomerProfileByEmail } from '@/lib/customer-profile';
```

to:

```ts
import { getCustomerProfile } from '@/lib/customer-profile';
```

- [ ] **Step 2: Stop loading profile before tickets are merged**

Replace the current first `Promise.all`:

```ts
  const [selectedTicket, recentTickets, customerProfile] = await Promise.all([
```

with:

```ts
  const [selectedTicket, recentTickets] = await Promise.all([
```

Remove the third item:

```ts
    getCustomerProfileByEmail(email)
```

and make sure the `db.ticket.findMany(...)` entry ends with `})`, not `}),`.

- [ ] **Step 3: Compute profile after `tickets` is available**

After:

```ts
  const tickets = Array.from(ticketMap.values());
```

add:

```ts
  const customerProfile = await getCustomerProfile({
    email,
    texts: tickets.flatMap((ticket) => [ticket.subject, ticket.originalText])
  });
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm.cmd exec vitest run --environment node src/lib/customer-profile.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full tests**

Run:

```powershell
npm.cmd test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```powershell
git add "src/app/api/customers/[email]/thread/route.ts"
git commit -m "feat: pass ticket text to order matching"
```

Expected: commit contains only the thread route.

---

### Task 5: Final Verification And Push

**Files:**
- No new files.

- [ ] **Step 1: Run tests**

Run:

```powershell
npm.cmd test
```

Expected: PASS.

- [ ] **Step 2: Validate Prisma schema**

Run:

```powershell
$env:DATABASE_URL='postgresql://user:pass@localhost:5432/review_admin'; npm.cmd exec prisma validate
```

Expected: Prisma schema is valid.

- [ ] **Step 3: Build with dummy required env**

Run:

```powershell
$env:DATABASE_URL='postgresql://user:pass@localhost:5432/review_admin'; $env:APP_SESSION_SECRET='dummy-session-secret-for-build-only'; $env:N8N_INGEST_SECRET='dummy-ingest-secret'; $env:N8N_SEND_APPROVED_WEBHOOK_URL='https://example.com/webhook'; $env:N8N_SEND_APPROVED_SECRET='dummy-send-secret'; $env:ADMIN_EMAILS='admin@example.com'; npm.cmd run build
```

Expected: Next build completes successfully.

- [ ] **Step 4: Check git status**

Run:

```powershell
git status --short --branch
```

Expected: `main` is ahead of `origin/main` by the new implementation commits, plus any pre-existing unrelated local files remain unstaged.

- [ ] **Step 5: Push**

Run:

```powershell
git push
```

Expected: `main -> main` pushed to `https://github.com/perezjensen/admin-n8n.git`.

---

## Self-Review

**Spec coverage:**

- Extracts `#45405`, `pedido 45405`, `orden 45405`, `order 77777`, and `compra 11223`: Task 1 and Task 2.
- Avoids address/postal-code false positives: Task 1.
- Searches by email and order number, fetches up to 25 rows internally, and displays only 5 recent orders: Task 3.
- Searches `orderNumber` with raw and hash variants, plus `externalOrderId` raw: Task 3.
- Allows order-number matches with a different email: Task 3.
- Dedupes email and number matches: Task 3.
- Passes ticket text from API: Task 4.
- UI unchanged: no UI files are modified.
- No live Shopify call: all lookups use `PlatformOrder`.

**Placeholder scan:**

- No placeholder sections remain.
- All code snippets define concrete functions and expected commands.

**Type consistency:**

- `CustomerProfileLookupInput`, `getCustomerProfile`, and `getCustomerProfileByEmail` are defined in Task 3 and used consistently in Task 4.
- Existing `CustomerProfile` response shape remains unchanged.

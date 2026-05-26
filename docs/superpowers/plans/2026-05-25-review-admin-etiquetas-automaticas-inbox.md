# Review Admin Etiquetas Automaticas Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic reason tags and tag filters to the Review Admin inbox without changing n8n, email sync, ticket status, database schema, or outbound replies.

**Architecture:** Add a pure helper `src/lib/ticket-tags.ts` that derives tags from existing ticket fields. API routes attach those derived tags to ticket JSON, and the inbox UI filters/presents them in memory. The feature is read-only and has no persistence, making rollback a normal code revert.

**Tech Stack:** Next.js 14 App Router, React client component, Prisma ticket data, Vitest, TypeScript.

---

## Safety Rules

- Do not touch n8n workflows.
- Do not touch IMAP, SMTP, webmail sync, or credentials.
- Do not add a Prisma migration.
- Do not alter `TicketStatus` or status-group behavior.
- Do not change send/reject/manual/discard flows.
- Keep existing category/intent rendering working while adding derived tags.
- Ignore unrelated current working tree changes: `scripts/wipe-tickets.ts` and `tsconfig.tsbuildinfo`.

## File Structure

- Create `src/lib/ticket-tags.ts`: pure tag derivation and tag metadata.
- Create `src/lib/ticket-tags.test.ts`: unit coverage for all tag rules.
- Modify `package.json`: include `ticket-tags.test.ts` in `npm test`.
- Modify `src/app/api/tickets/route.ts`: add `tags` to inbox ticket JSON.
- Modify `src/app/api/customers/[email]/tickets/route.ts`: add `tags` to conversation ticket JSON.
- Modify `src/app/inbox-client.tsx`: add tag types, filter state, filter buttons, and tag badges.

---

### Task 1: Add Automatic Tag Helper

**Files:**
- Create: `src/lib/ticket-tags.ts`
- Create: `src/lib/ticket-tags.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create `src/lib/ticket-tags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getTicketTags } from './ticket-tags';

const baseTicket = {
  subject: '',
  originalText: '',
  category: '',
  intent: '',
  riskFlags: '',
  escalationRecommended: false
};

describe('getTicketTags', () => {
  it('returns Escalar when escalation is recommended', () => {
    expect(getTicketTags({ ...baseTicket, escalationRecommended: true }).map((tag) => tag.id)).toEqual(['escalate']);
  });

  it('returns Devolucion for refund and cancellation language', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        subject: 'Quiero cancelar mi pedido',
        originalText: 'Necesito una devolucion o reembolso del dinero'
      }).map((tag) => tag.id)
    ).toContain('refund');
  });

  it('returns Problema envio for shipping and tracking language', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        category: 'Logistica de Web',
        intent: 'order_status',
        originalText: 'No he recibido el pedido y no llega el seguimiento de Tipsa'
      }).map((tag) => tag.id)
    ).toContain('shipping');
  });

  it('returns Problema producto for dosage and results language', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        category: 'Producto/Salud',
        originalText: 'No noto efectos y quiero saber la dosis para tomar las gomitas'
      }).map((tag) => tag.id)
    ).toContain('product');
  });

  it('can return multiple tags in stable order', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        escalationRecommended: true,
        originalText: 'No he recibido mi pedido y quiero cancelar'
      }).map((tag) => tag.id)
    ).toEqual(['escalate', 'refund', 'shipping']);
  });

  it('returns an empty list when there are no matches', () => {
    expect(getTicketTags({ ...baseTicket, originalText: 'Muchas gracias por la informacion' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm.cmd exec vitest run --environment node src/lib/ticket-tags.test.ts
```

Expected: fails because `src/lib/ticket-tags.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/ticket-tags.ts`:

```ts
export const ticketTagDefinitions = [
  { id: 'escalate', label: 'Escalar', tone: 'danger' },
  { id: 'refund', label: 'Devolucion', tone: 'warning' },
  { id: 'shipping', label: 'Problema envio', tone: 'info' },
  { id: 'product', label: 'Problema producto', tone: 'neutral' }
] as const;

export type TicketTagId = (typeof ticketTagDefinitions)[number]['id'];
export type TicketTagTone = (typeof ticketTagDefinitions)[number]['tone'];

export type TicketTag = {
  id: TicketTagId;
  label: string;
  tone: TicketTagTone;
};

export type TaggableTicket = {
  subject?: string | null;
  originalText?: string | null;
  category?: string | null;
  intent?: string | null;
  riskFlags?: string | null;
  escalationRecommended?: boolean | null;
};

const tagById = new Map<TicketTagId, TicketTag>(
  ticketTagDefinitions.map((tag) => [tag.id, tag])
);

const refundPatterns = [
  'devolucion',
  'reembolso',
  'cancelar',
  'cancelacion',
  'baja',
  'dinero',
  'formulario'
];

const shippingPatterns = [
  'envio',
  'pedido',
  'seguimiento',
  'tracking',
  'transportista',
  'tipsa',
  'no recibido',
  'no he recibido',
  'no ha llegado',
  'no llega',
  'donde esta',
  'cuando llega',
  'direccion incompleta',
  'falta el numero',
  'order_status'
];

const productPatterns = [
  'producto',
  'gomitas',
  'dosis',
  'tomar',
  'efectos',
  'resultados',
  'salud',
  'ingredientes',
  'no noto',
  'me funciona',
  'diarrea',
  'hinchazon',
  'digestion'
];

const escalationPatterns = ['riesgo', 'humana', 'manual', 'escalar', 'revisar'];

export function getTicketTags(ticket: TaggableTicket): TicketTag[] {
  const haystack = normalize(
    [
      ticket.subject,
      ticket.originalText,
      ticket.category,
      ticket.intent,
      ticket.riskFlags
    ].join(' ')
  );

  const ids: TicketTagId[] = [];

  if (ticket.escalationRecommended || includesAny(haystack, escalationPatterns)) {
    ids.push('escalate');
  }
  if (includesAny(haystack, refundPatterns)) {
    ids.push('refund');
  }
  if (includesAny(haystack, shippingPatterns) || haystack.includes('logistica')) {
    ids.push('shipping');
  }
  if (
    includesAny(haystack, productPatterns) ||
    haystack.includes('producto') ||
    haystack.includes('salud')
  ) {
    ids.push('product');
  }

  return ids.map((id) => tagById.get(id)).filter((tag): tag is TicketTag => Boolean(tag));
}

function includesAny(value: string, patterns: string[]) {
  return patterns.some((pattern) => value.includes(pattern));
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Add test file to package script**

In `package.json`, update the `test` script to include `src/lib/ticket-tags.test.ts`:

```json
"test": "vitest run --environment node src/lib/status.test.ts src/lib/auth.test.ts src/lib/forms.test.ts src/lib/form-uploads.test.ts src/lib/return-form-fields.test.ts src/lib/sales.test.ts src/lib/tickets.test.ts src/lib/webmail-sync.test.ts src/lib/ticket-tags.test.ts"
```

- [ ] **Step 5: Run helper tests**

Run:

```powershell
npm.cmd exec vitest run --environment node src/lib/ticket-tags.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit if implementing in Git**

Run:

```powershell
git add package.json src/lib/ticket-tags.ts src/lib/ticket-tags.test.ts
git commit -m "feat: derive automatic ticket tags"
```

---

### Task 2: Add Derived Tags To Ticket APIs

**Files:**
- Modify: `src/app/api/tickets/route.ts`
- Modify: `src/app/api/customers/[email]/tickets/route.ts`

- [ ] **Step 1: Import the helper in the inbox API**

In `src/app/api/tickets/route.ts`, add:

```ts
import { getTicketTags } from '@/lib/ticket-tags';
```

- [ ] **Step 2: Add `tags` to inbox ticket JSON**

Inside the `tickets.map((ticket) => ({ ... }))` object in `src/app/api/tickets/route.ts`, add:

```ts
      tags: getTicketTags(ticket),
```

Place it near `category`, `intent`, or `riskFlags`.

- [ ] **Step 3: Import the helper in the customer conversation API**

In `src/app/api/customers/[email]/tickets/route.ts`, add:

```ts
import { getTicketTags } from '@/lib/ticket-tags';
```

- [ ] **Step 4: Add `tags` to conversation ticket JSON**

Inside `tickets.map((t) => ({ ... }))`, add:

```ts
      tags: getTicketTags(t),
```

Place it near `category`, `intent`, or `riskFlags`.

- [ ] **Step 5: Run TypeScript check through build**

Run:

```powershell
$env:DATABASE_URL='postgresql://user:pass@localhost:5432/review_admin'; $env:APP_SESSION_SECRET='12345678901234567890123456789012'; $env:N8N_INGEST_SECRET='1234567890123456'; $env:N8N_SEND_APPROVED_WEBHOOK_URL='https://example.com/webhook'; $env:N8N_SEND_APPROVED_SECRET='1234567890123456'; $env:ADMIN_EMAILS='admin@example.com'; npm.cmd run build
```

Expected: build passes.

- [ ] **Step 6: Commit if implementing in Git**

Run:

```powershell
git add src/app/api/tickets/route.ts src/app/api/customers/[email]/tickets/route.ts
git commit -m "feat: expose automatic ticket tags"
```

---

### Task 3: Add Tag Filters And Badges To Inbox UI

**Files:**
- Modify: `src/app/inbox-client.tsx`

- [ ] **Step 1: Add tag types to the client**

Near the existing `TicketEvent` type in `src/app/inbox-client.tsx`, add:

```ts
type TicketTag = {
  id: 'escalate' | 'refund' | 'shipping' | 'product';
  label: string;
  tone: 'danger' | 'warning' | 'info' | 'neutral';
};

type ActiveTagFilter = 'all' | TicketTag['id'];
```

Add this field to `type Ticket`:

```ts
  tags: TicketTag[];
```

- [ ] **Step 2: Add tag filter state and filtered tickets**

Inside `InboxClient`, after `const [query, setQuery] = useState('');`, add:

```ts
  const [activeTagFilter, setActiveTagFilter] = useState<ActiveTagFilter>('all');
```

After `selectedTicket`, add:

```ts
  const visibleTickets = useMemo(() => {
    if (activeTagFilter === 'all') return tickets;
    return tickets.filter((ticket) => ticket.tags.some((tag) => tag.id === activeTagFilter));
  }, [activeTagFilter, tickets]);
```

Change `selectedTicket` to use `visibleTickets` instead of `tickets`:

```ts
  const selectedTicket = useMemo(
    () => visibleTickets.find((t) => t.id === selectedId) || visibleTickets[0] || null,
    [selectedId, visibleTickets]
  );
```

Keep `customers` based on `visibleTickets`:

```ts
    for (const t of visibleTickets) {
```

and update its dependency array:

```ts
  }, [visibleTickets]);
```

- [ ] **Step 3: Keep selection stable after filtering**

In `loadTickets`, change `incomingIds` to still use all incoming tickets:

```ts
const incomingIds = new Set(data.tickets.map((t) => t.id));
```

Do not filter server data there. Filtering remains UI-only.

Add an effect after the existing draft sync effect:

```ts
  useEffect(() => {
    if (selectedId && visibleTickets.some((ticket) => ticket.id === selectedId)) return;
    setSelectedId(visibleTickets[0]?.id || null);
  }, [selectedId, visibleTickets]);
```

- [ ] **Step 4: Add filter buttons to the toolbar**

After the `view-toggle` div in `src/app/inbox-client.tsx`, add:

```tsx
            <div className="tag-filter" aria-label="Filtrar por etiqueta">
              {[
                { id: 'all', label: 'Todos' },
                { id: 'escalate', label: 'Escalar' },
                { id: 'refund', label: 'Devolucion' },
                { id: 'shipping', label: 'Problema envio' },
                { id: 'product', label: 'Problema producto' }
              ].map((tag) => (
                <button
                  className={activeTagFilter === tag.id ? 'tag-filter-btn active' : 'tag-filter-btn'}
                  key={tag.id}
                  type="button"
                  onClick={() => setActiveTagFilter(tag.id as ActiveTagFilter)}
                >
                  {tag.label}
                </button>
              ))}
            </div>
```

- [ ] **Step 5: Render visible tickets**

Replace:

```tsx
{tickets.map((ticket) => (
```

with:

```tsx
{visibleTickets.map((ticket) => (
```

Replace the empty state condition:

```tsx
{!loading && !tickets.length ? (
```

with:

```tsx
{!loading && !visibleTickets.length ? (
```

- [ ] **Step 6: Add tag badges in list rows**

Inside the existing `<span className="row-tags">`, before category/intent badges, add:

```tsx
                      <TagBadges tags={ticket.tags} />
```

Remove this line to avoid duplicate Escalar:

```tsx
{ticket.escalationRecommended ? <b className="tag-escalate">âš¡ Escalar</b> : null}
```

Keep risk fallback:

```tsx
{ticket.riskFlags && !ticket.escalationRecommended ? <b>Revisar riesgo</b> : null}
```

- [ ] **Step 7: Add tag badges in conversation and detail views**

In `ConversationPane`, inside client message `.bubble-tags`, before category/intent, add:

```tsx
                    <TagBadges tags={ticket.tags} />
```

In `ReviewPane`, inside the first `.detail-strip`, after status/category/intent metadata, add:

```tsx
        <TagBadges tags={ticket.tags} />
```

- [ ] **Step 8: Add the TagBadges component**

Before `StatusBadge`, add:

```tsx
function TagBadges({ tags }: { tags: TicketTag[] }) {
  if (!tags.length) return null;
  return (
    <>
      {tags.map((tag) => (
        <em className={`ticket-tag tag-${tag.tone}`} key={tag.id}>
          {tag.label}
        </em>
      ))}
    </>
  );
}
```

- [ ] **Step 9: Run build**

Run:

```powershell
$env:DATABASE_URL='postgresql://user:pass@localhost:5432/review_admin'; $env:APP_SESSION_SECRET='12345678901234567890123456789012'; $env:N8N_INGEST_SECRET='1234567890123456'; $env:N8N_SEND_APPROVED_WEBHOOK_URL='https://example.com/webhook'; $env:N8N_SEND_APPROVED_SECRET='1234567890123456'; $env:ADMIN_EMAILS='admin@example.com'; npm.cmd run build
```

Expected: build passes.

- [ ] **Step 10: Commit if implementing in Git**

Run:

```powershell
git add src/app/inbox-client.tsx
git commit -m "feat: filter inbox by automatic tags"
```

---

### Task 4: Add Minimal Styling For Tag Filters

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add compact styles**

Append these styles to `src/app/globals.css`:

```css
.tag-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
}

.tag-filter-btn {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--muted);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.tag-filter-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(30, 150, 160, 0.08);
}

.ticket-tag {
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  font-style: normal;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  padding: 5px 8px;
}

.ticket-tag.tag-danger {
  background: #fee2e2;
  color: #991b1b;
}

.ticket-tag.tag-warning {
  background: #fef3c7;
  color: #92400e;
}

.ticket-tag.tag-info {
  background: #dbeafe;
  color: #1e3a8a;
}

.ticket-tag.tag-neutral {
  background: #ede9fe;
  color: #4c1d95;
}
```

- [ ] **Step 2: Run build**

Run:

```powershell
$env:DATABASE_URL='postgresql://user:pass@localhost:5432/review_admin'; $env:APP_SESSION_SECRET='12345678901234567890123456789012'; $env:N8N_INGEST_SECRET='1234567890123456'; $env:N8N_SEND_APPROVED_WEBHOOK_URL='https://example.com/webhook'; $env:N8N_SEND_APPROVED_SECRET='1234567890123456'; $env:ADMIN_EMAILS='admin@example.com'; npm.cmd run build
```

Expected: build passes and no CSS syntax errors occur.

- [ ] **Step 3: Commit if implementing in Git**

Run:

```powershell
git add src/app/globals.css
git commit -m "style: add automatic tag badges"
```

---

### Task 5: Full Verification And Production Safety

**Files:**
- All changed files from previous tasks.

- [ ] **Step 1: Run the full test suite**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass, including `ticket-tags.test.ts`.

- [ ] **Step 2: Run production build with dummy local env**

Run:

```powershell
$env:DATABASE_URL='postgresql://user:pass@localhost:5432/review_admin'; $env:APP_SESSION_SECRET='12345678901234567890123456789012'; $env:N8N_INGEST_SECRET='1234567890123456'; $env:N8N_SEND_APPROVED_WEBHOOK_URL='https://example.com/webhook'; $env:N8N_SEND_APPROVED_SECRET='1234567890123456'; $env:ADMIN_EMAILS='admin@example.com'; npm.cmd run build
```

Expected: build passes.

- [ ] **Step 3: Check no production-sensitive files changed**

Run:

```powershell
git diff --name-only HEAD
```

Expected changed files are limited to:

```text
package.json
src/lib/ticket-tags.ts
src/lib/ticket-tags.test.ts
src/app/api/tickets/route.ts
src/app/api/customers/[email]/tickets/route.ts
src/app/inbox-client.tsx
src/app/globals.css
```

If `package-lock.json` did not change, do not stage it. If unrelated files like `scripts/wipe-tickets.ts` or `tsconfig.tsbuildinfo` appear, leave them unstaged.

- [ ] **Step 4: Commit remaining changes if any**

Run:

```powershell
git add package.json src/lib/ticket-tags.ts src/lib/ticket-tags.test.ts src/app/api/tickets/route.ts src/app/api/customers/[email]/tickets/route.ts src/app/inbox-client.tsx src/app/globals.css
git commit -m "feat: add automatic inbox tags"
```

If all changes were already committed in earlier tasks, this step should report nothing to commit.

- [ ] **Step 5: Push after final approval**

Run:

```powershell
git push origin main
```

Expected: push succeeds.

---

## Self-Review

Spec coverage:

- Automatic tags from existing ticket fields: Task 1.
- API exposes tags: Task 2.
- Inbox badges and filters: Task 3.
- Detail and conversation tag display: Task 3.
- No DB/n8n/email changes: Safety Rules and Task 5 changed-file check.
- Tests: Task 1 and Task 5.
- Rollback by code revert only: no migration tasks included.

Placeholder scan:

- No incomplete implementation markers.
- Every task lists exact files.
- Code snippets define all referenced types and functions.

Type consistency:

- `TicketTag.id` values are `escalate`, `refund`, `shipping`, and `product`.
- UI filter uses `ActiveTagFilter = 'all' | TicketTag['id']`.
- API returns `tags` as full tag objects, matching UI type.

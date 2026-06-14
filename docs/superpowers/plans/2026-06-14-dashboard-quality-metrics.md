# Dashboard Quality Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build honest dashboard quality metrics based on `sentAt`: sent without edit, edited before send, edit intensity, corrected sensitive cases, and classification coverage that does not punish historical unclassified tickets.

**Architecture:** Add a pure calculation module for dashboard quality metrics, then let the dashboard API query minimal ticket fields and delegate calculations to that module. The UI consumes the new API shape while preserving existing dashboard behavior and labels.

**Tech Stack:** Next.js App Router, Prisma, TypeScript, Vitest, React.

---

## File Structure

- Create: `src/lib/dashboard-quality.ts`
  - Pure helpers for edit intensity, send-quality aggregation, risk flag trimming, routing eligibility, and sentiment eligibility.
- Create: `src/lib/dashboard-quality.test.ts`
  - Unit tests for all metric math without Prisma or React.
- Modify: `src/app/api/dashboard/route.ts`
  - Fetch minimal ticket rows and return `sendQuality`, `qualityBySendDay`, `labelingQuality`, and `sentimentQuality`.
- Modify: `src/app/dashboard/dashboard-client.tsx`
  - Display the new KPI cards and daily quality trend.
- Modify: `src/app/globals.css`
  - Add compact styles for the quality trend panel.
- Modify: `src/app/api/tickets/[id]/send/route.ts`
  - Store edit metrics in `AuditEvent.metadataJson` when a ticket is sent.
- Modify: `src/app/api/customers/[email]/thread/send/route.ts`
  - Store edit metrics for thread follow-up audit events when an AI draft exists.
- Modify: `package.json`
  - Include `src/lib/dashboard-quality.test.ts` in the test script.

---

### Task 1: Add Pure Dashboard Quality Metrics

**Files:**
- Create: `src/lib/dashboard-quality.ts`
- Create: `src/lib/dashboard-quality.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/dashboard-quality.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildQualityBySendDay,
  editIntensity,
  hasMeaningfulRiskFlag,
  summarizeLabelingQuality,
  summarizeSendQuality,
  summarizeSentimentQuality
} from './dashboard-quality';

describe('editIntensity', () => {
  it('returns 0 for identical normalized replies', () => {
    expect(editIntensity(' Hola   Maria ', 'Hola Maria')).toBe(0);
  });

  it('returns a small ratio for light edits', () => {
    expect(editIntensity('Hola Maria', 'Hola Maria, gracias')).toBeGreaterThan(0);
    expect(editIntensity('Hola Maria', 'Hola Maria, gracias')).toBeLessThan(0.6);
  });

  it('returns 1 for totally different empty-to-full edits', () => {
    expect(editIntensity('', 'Respuesta nueva')).toBe(1);
  });
});

describe('send quality', () => {
  it('summarizes sent without edit, edited rate, and edit intensity', () => {
    const summary = summarizeSendQuality([
      {
        status: 'approved_sent',
        sentAt: new Date('2026-06-12T10:00:00.000Z'),
        aiReply: 'Hola Maria',
        finalReply: 'Hola Maria'
      },
      {
        status: 'edited_sent',
        sentAt: new Date('2026-06-12T11:00:00.000Z'),
        aiReply: 'Hola Maria',
        finalReply: 'Hola Maria, te ayudo con tu pedido.'
      },
      {
        status: 'discarded',
        sentAt: null,
        aiReply: 'No cuenta',
        finalReply: null
      }
    ]);

    expect(summary.sentTotal).toBe(2);
    expect(summary.approvedSent).toBe(1);
    expect(summary.editedSent).toBe(1);
    expect(summary.sentWithoutEditRate).toBe(50);
    expect(summary.editedBeforeSendRate).toBe(50);
    expect(summary.avgEditIntensityEdited).toBeGreaterThan(0);
    expect(summary.avgEditIntensityAll).toBeGreaterThan(0);
    expect(summary.avgEditIntensityAll).toBeLessThan(summary.avgEditIntensityEdited);
  });

  it('builds a daily series by sentAt and fills empty days', () => {
    const rows = buildQualityBySendDay(
      [
        {
          status: 'approved_sent',
          sentAt: new Date('2026-06-10T10:00:00.000Z'),
          aiReply: 'Respuesta',
          finalReply: 'Respuesta'
        },
        {
          status: 'edited_sent',
          sentAt: new Date('2026-06-12T10:00:00.000Z'),
          aiReply: 'Respuesta',
          finalReply: 'Respuesta editada'
        }
      ],
      new Date('2026-06-10T00:00:00.000Z'),
      3
    );

    expect(rows).toEqual([
      {
        date: '2026-06-10',
        sentTotal: 1,
        approvedSent: 1,
        editedSent: 0,
        sentWithoutEditRate: 100,
        editedBeforeSendRate: 0,
        avgEditIntensity: 0
      },
      {
        date: '2026-06-11',
        sentTotal: 0,
        approvedSent: 0,
        editedSent: 0,
        sentWithoutEditRate: 0,
        editedBeforeSendRate: 0,
        avgEditIntensity: 0
      },
      {
        date: '2026-06-12',
        sentTotal: 1,
        approvedSent: 0,
        editedSent: 1,
        sentWithoutEditRate: 0,
        editedBeforeSendRate: 100,
        avgEditIntensity: expect.any(Number)
      }
    ]);
    expect(rows[2].avgEditIntensity).toBeGreaterThan(0);
  });
});

describe('risk and coverage quality', () => {
  it('ignores empty risk flags but counts escalation', () => {
    expect(hasMeaningfulRiskFlag(null)).toBe(false);
    expect(hasMeaningfulRiskFlag('')).toBe(false);
    expect(hasMeaningfulRiskFlag('   ')).toBe(false);
    expect(hasMeaningfulRiskFlag('refund_dispute')).toBe(true);
  });

  it('separates closed labels, new unlabeled, and historical unclassified tickets', () => {
    const summary = summarizeLabelingQuality([
      {
        routedTemplateId: 'sub_baja_generica',
        routeSource: 'canonical_router',
        caseReasoningJson: { family: 'suscripcion' }
      },
      {
        routedTemplateId: null,
        routeSource: 'canonical_router',
        caseReasoningJson: { family: 'producto' }
      },
      {
        routedTemplateId: null,
        routeSource: null,
        caseReasoningJson: null
      }
    ]);

    expect(summary.eligibleForRouting).toBe(2);
    expect(summary.closedLabelCount).toBe(1);
    expect(summary.newUnlabeledCount).toBe(1);
    expect(summary.historicalUnclassifiedCount).toBe(1);
    expect(summary.closedLabelRate).toBe(50);
  });

  it('calculates sentiment coverage only over eligible tickets', () => {
    const summary = summarizeSentimentQuality([
      {
        sentiment: 'molesto',
        sentimentSource: 'live_classifier',
        routeSource: 'canonical_router',
        caseReasoningJson: { family: 'suscripcion' }
      },
      {
        sentiment: null,
        sentimentSource: null,
        routeSource: 'canonical_router',
        caseReasoningJson: { family: 'producto' }
      },
      {
        sentiment: null,
        sentimentSource: null,
        routeSource: null,
        caseReasoningJson: null
      }
    ]);

    expect(summary.eligibleForSentiment).toBe(2);
    expect(summary.sentimentAnalyzed).toBe(1);
    expect(summary.sentimentCoverage).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm.cmd exec vitest run --environment node src/lib/dashboard-quality.test.ts
```

Expected: FAIL because `src/lib/dashboard-quality.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/lib/dashboard-quality.ts`:

```ts
type SentStatus = 'approved_sent' | 'edited_sent' | string;

export type SendQualityTicket = {
  status: SentStatus;
  sentAt: Date | null;
  aiReply: string | null;
  finalReply: string | null;
};

export type LabelingQualityTicket = {
  routedTemplateId: string | null;
  routeSource: string | null;
  caseReasoningJson: unknown | null;
};

export type SentimentQualityTicket = {
  sentiment: string | null;
  sentimentSource: string | null;
  routeSource: string | null;
  caseReasoningJson: unknown | null;
};

export type SendQualitySummary = {
  sentTotal: number;
  approvedSent: number;
  editedSent: number;
  sentWithoutEditRate: number;
  editedBeforeSendRate: number;
  avgEditIntensityEdited: number;
  avgEditIntensityAll: number;
};

export type QualityBySendDay = {
  date: string;
  sentTotal: number;
  approvedSent: number;
  editedSent: number;
  sentWithoutEditRate: number;
  editedBeforeSendRate: number;
  avgEditIntensity: number;
};

export type LabelingQualitySummary = {
  eligibleForRouting: number;
  closedLabelCount: number;
  newUnlabeledCount: number;
  historicalUnclassifiedCount: number;
  closedLabelRate: number;
};

export type SentimentQualitySummary = {
  eligibleForSentiment: number;
  sentimentAnalyzed: number;
  sentimentCoverage: number;
};

export function percent(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

export function normalizeDashboardText(text: string | null | undefined): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j];
  }

  return previous[b.length];
}

export function editIntensity(aiReply: string | null | undefined, finalReply: string | null | undefined): number {
  const original = normalizeDashboardText(aiReply);
  const final = normalizeDashboardText(finalReply);
  const denominator = Math.max(original.length, final.length, 1);
  return Math.min(1, Math.round((levenshtein(original, final) / denominator) * 100) / 100);
}

function sentTickets(tickets: SendQualityTicket[]): SendQualityTicket[] {
  return tickets.filter((ticket) => ticket.sentAt && ['approved_sent', 'edited_sent'].includes(ticket.status));
}

export function summarizeSendQuality(tickets: SendQualityTicket[]): SendQualitySummary {
  const sent = sentTickets(tickets);
  const approvedSent = sent.filter((ticket) => ticket.status === 'approved_sent').length;
  const edited = sent.filter((ticket) => ticket.status === 'edited_sent');
  const editedSent = edited.length;
  const editedIntensities = edited.map((ticket) => editIntensity(ticket.aiReply, ticket.finalReply));
  const allIntensities = sent.map((ticket) =>
    ticket.status === 'edited_sent' ? editIntensity(ticket.aiReply, ticket.finalReply) : 0
  );

  return {
    sentTotal: sent.length,
    approvedSent,
    editedSent,
    sentWithoutEditRate: percent(approvedSent, sent.length),
    editedBeforeSendRate: percent(editedSent, sent.length),
    avgEditIntensityEdited: averagePercent(editedIntensities),
    avgEditIntensityAll: averagePercent(allIntensities)
  };
}

function averagePercent(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100);
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildQualityBySendDay(
  tickets: SendQualityTicket[],
  startDate: Date,
  days: number
): QualityBySendDay[] {
  const groups = new Map<string, SendQualityTicket[]>();
  for (const ticket of sentTickets(tickets)) {
    if (!ticket.sentAt) continue;
    const key = dayKey(ticket.sentAt);
    groups.set(key, [...(groups.get(key) ?? []), ticket]);
  }

  const result: QualityBySendDay[] = [];
  for (let index = 0; index < days; index++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    const dateKey = dayKey(date);
    const rows = groups.get(dateKey) ?? [];
    const summary = summarizeSendQuality(rows);
    result.push({
      date: dateKey,
      sentTotal: summary.sentTotal,
      approvedSent: summary.approvedSent,
      editedSent: summary.editedSent,
      sentWithoutEditRate: summary.sentWithoutEditRate,
      editedBeforeSendRate: summary.editedBeforeSendRate,
      avgEditIntensity: summary.avgEditIntensityEdited
    });
  }

  return result;
}

export function hasMeaningfulRiskFlag(value: string | null | undefined): boolean {
  return String(value ?? '').trim().length > 0;
}

export function isRoutingEligible(ticket: LabelingQualityTicket): boolean {
  return Boolean(ticket.routeSource || ticket.caseReasoningJson || ticket.routedTemplateId);
}

export function summarizeLabelingQuality(tickets: LabelingQualityTicket[]): LabelingQualitySummary {
  const eligible = tickets.filter(isRoutingEligible);
  const closedLabelCount = eligible.filter((ticket) => Boolean(ticket.routedTemplateId)).length;
  const historicalUnclassifiedCount = tickets.length - eligible.length;

  return {
    eligibleForRouting: eligible.length,
    closedLabelCount,
    newUnlabeledCount: Math.max(eligible.length - closedLabelCount, 0),
    historicalUnclassifiedCount,
    closedLabelRate: percent(closedLabelCount, eligible.length)
  };
}

export function isSentimentEligible(ticket: SentimentQualityTicket): boolean {
  return Boolean(ticket.sentimentSource || ticket.routeSource || ticket.caseReasoningJson || ticket.sentiment);
}

export function summarizeSentimentQuality(tickets: SentimentQualityTicket[]): SentimentQualitySummary {
  const eligible = tickets.filter(isSentimentEligible);
  const sentimentAnalyzed = eligible.filter((ticket) => Boolean(ticket.sentiment)).length;

  return {
    eligibleForSentiment: eligible.length,
    sentimentAnalyzed,
    sentimentCoverage: percent(sentimentAnalyzed, eligible.length)
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm.cmd exec vitest run --environment node src/lib/dashboard-quality.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-quality.ts src/lib/dashboard-quality.test.ts
git commit -m "Add dashboard quality metric helpers"
```

---

### Task 2: Wire Dashboard API to New Metrics

**Files:**
- Modify: `src/app/api/dashboard/route.ts`

- [ ] **Step 1: Add imports**

Modify the import block in `src/app/api/dashboard/route.ts`:

```ts
import {
  buildQualityBySendDay,
  hasMeaningfulRiskFlag,
  percent,
  summarizeLabelingQuality,
  summarizeSendQuality,
  summarizeSentimentQuality
} from '@/lib/dashboard-quality';
```

Then remove the local `percent` function from this file.

- [ ] **Step 2: Query send-quality and classification rows**

In the `Promise.all` destructuring, add these values after `rawSentimentByFamily`:

```ts
    sentQualityTickets,
    classificationTickets,
```

Add these promises at the end of the `Promise.all` array:

```ts
    db.ticket.findMany({
      where: {
        sentAt: { gte: startDate },
        status: { in: ['approved_sent', 'edited_sent'] }
      },
      select: {
        status: true,
        sentAt: true,
        aiReply: true,
        finalReply: true
      }
    }),
    db.ticket.findMany({
      where: { receivedAt: { gte: startDate } },
      select: {
        routedTemplateId: true,
        routeSource: true,
        caseReasoningJson: true,
        sentiment: true,
        sentimentSource: true,
        riskFlags: true,
        escalationRecommended: true
      }
    }),
```

- [ ] **Step 3: Replace sensitive count calculation**

Replace the existing `sensitiveInPeriod` query usage by computing from `classificationTickets`:

```ts
  const sensitiveCount = classificationTickets.filter(
    (ticket) => ticket.escalationRecommended || hasMeaningfulRiskFlag(ticket.riskFlags)
  ).length;
```

Then set:

```ts
  const sensitiveRate = percent(sensitiveCount, totalInPeriod);
```

Remove the `sensitiveInPeriod` count from `Promise.all`.

- [ ] **Step 4: Build new summaries**

After the `approvedSent`, `editedSent`, and `discarded` constants, add:

```ts
  const sendQuality = summarizeSendQuality(sentQualityTickets);
  const qualityBySendDay = buildQualityBySendDay(sentQualityTickets, startDate, d);
  const labelingQuality = summarizeLabelingQuality(classificationTickets);
  const sentimentQuality = summarizeSentimentQuality(classificationTickets);
```

Then change:

```ts
  const aiAccuracy = sendQuality.sentWithoutEditRate;
  const closedLabelRate = labelingQuality.closedLabelRate;
```

Keep `abandonRate` and `escalationRate` as received-period metrics.

- [ ] **Step 5: Keep reason groups but use eligible denominator for labels**

Leave `reasonsByFamily` mostly unchanged, but use the new `labelingQuality` fields in the response. Keep the existing `Sin etiqueta cerrada` group for visibility only if `labelingQuality.newUnlabeledCount > 0`.

Replace the old unlabeled block:

```ts
  if (unlabeledCount > 0) {
    const metadata = templateLabelFor(null);
    addReason(reasonGroups, 'sin_etiqueta', {
      id: null,
      label: metadata.label,
      count: unlabeledCount,
      percentOfTotal: percent(unlabeledCount, totalInPeriod)
    });
  }
```

with:

```ts
  if (labelingQuality.newUnlabeledCount > 0) {
    const metadata = templateLabelFor(null);
    addReason(reasonGroups, 'sin_etiqueta', {
      id: null,
      label: metadata.label,
      count: labelingQuality.newUnlabeledCount,
      percentOfTotal: percent(labelingQuality.newUnlabeledCount, Math.max(labelingQuality.eligibleForRouting, 1))
    });
  }
```

- [ ] **Step 6: Return new API fields**

Add these fields to the JSON response:

```ts
    sendQuality,
    qualityBySendDay,
    labelingQuality,
    sentimentQuality,
```

Change existing compatibility fields:

```ts
    closedLabelRate: labelingQuality.closedLabelRate,
    sentimentCoverage: sentimentQuality.sentimentCoverage,
    aiAccuracy: sendQuality.sentWithoutEditRate,
    sensitiveRate,
```

- [ ] **Step 7: Run checks**

Run:

```bash
npm.cmd exec tsc --noEmit
npm.cmd exec vitest run --environment node src/lib/dashboard-quality.test.ts
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/dashboard/route.ts
git commit -m "Use sent-date quality metrics in dashboard API"
```

---

### Task 3: Store Edit Metrics in Send Audit Events

**Files:**
- Modify: `src/app/api/tickets/[id]/send/route.ts`
- Modify: `src/app/api/customers/[email]/thread/send/route.ts`

- [ ] **Step 1: Import editIntensity**

In both files, add:

```ts
import { editIntensity } from '@/lib/dashboard-quality';
```

- [ ] **Step 2: Compute metrics in ticket send route**

In `src/app/api/tickets/[id]/send/route.ts`, after `const approvalAction = edited ? 'edited' : 'approved';`, add:

```ts
  const editMetrics = {
    edited,
    edit_intensity: edited ? editIntensity(ticket.aiReply, finalReply) : 0,
    ai_reply_length: ticket.aiReply.trim().length,
    final_reply_length: finalReply.trim().length
  };
```

In the success audit event, replace:

```ts
        edited,
```

with:

```ts
        ...editMetrics,
```

- [ ] **Step 3: Compute metrics in thread send route**

In `src/app/api/customers/[email]/thread/send/route.ts`, after `const finalReply = String(payload.final_reply || '').trim();`, add:

```ts
  let editMetrics = {
    edited: true,
    edit_intensity: 0,
    ai_reply_length: 0,
    final_reply_length: finalReply.length
  };
```

After the `ticket` lookup and `if (!ticket)` block, add:

```ts
  editMetrics = {
    edited: true,
    edit_intensity: editIntensity(ticket.aiReply, finalReply),
    ai_reply_length: ticket.aiReply.trim().length,
    final_reply_length: finalReply.trim().length
  };
```

In the final audit event `metadataJson`, add:

```ts
        ...editMetrics,
```

- [ ] **Step 4: Run checks**

Run:

```bash
npm.cmd exec tsc --noEmit
npm.cmd exec vitest run --environment node src/lib/dashboard-quality.test.ts src/lib/status.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tickets/[id]/send/route.ts src/app/api/customers/[email]/thread/send/route.ts
git commit -m "Store reply edit metrics in audit events"
```

---

### Task 4: Update Dashboard UI Types and KPI Cards

**Files:**
- Modify: `src/app/dashboard/dashboard-client.tsx`

- [ ] **Step 1: Extend dashboard types**

Add these types near the existing dashboard data types:

```ts
type SendQuality = {
  sentTotal: number;
  approvedSent: number;
  editedSent: number;
  sentWithoutEditRate: number;
  editedBeforeSendRate: number;
  avgEditIntensityEdited: number;
  avgEditIntensityAll: number;
};

type QualityBySendDay = {
  date: string;
  sentTotal: number;
  approvedSent: number;
  editedSent: number;
  sentWithoutEditRate: number;
  editedBeforeSendRate: number;
  avgEditIntensity: number;
};

type LabelingQuality = {
  eligibleForRouting: number;
  closedLabelCount: number;
  newUnlabeledCount: number;
  historicalUnclassifiedCount: number;
  closedLabelRate: number;
};

type SentimentQuality = {
  eligibleForSentiment: number;
  sentimentAnalyzed: number;
  sentimentCoverage: number;
};
```

Add to `DashboardData`:

```ts
  sendQuality: SendQuality;
  qualityBySendDay: QualityBySendDay[];
  labelingQuality: LabelingQuality;
  sentimentQuality: SentimentQuality;
```

- [ ] **Step 2: Add a quality trend component**

Add this component after `BarChart`:

```tsx
function QualityTrend({ data }: { data: QualityBySendDay[] }) {
  const maxSent = Math.max(...data.map((day) => day.sentTotal), 1);

  return (
    <div className="db-quality-trend">
      {data.map((day) => (
        <div key={day.date} className="db-quality-day">
          <div className="db-quality-bars">
            <span
              className="db-quality-bar db-quality-approved"
              style={{ height: `${Math.max(4, Math.round((day.approvedSent / maxSent) * 100))}%` }}
              title={`${formatDate(day.date)}: ${day.approvedSent} sin editar`}
            />
            <span
              className="db-quality-bar db-quality-edited"
              style={{ height: `${Math.max(4, Math.round((day.editedSent / maxSent) * 100))}%` }}
              title={`${formatDate(day.date)}: ${day.editedSent} editados`}
            />
          </div>
          <span className="db-quality-date">{formatDate(day.date)}</span>
          <strong className="db-quality-rate">{day.sentWithoutEditRate}%</strong>
          <span className="db-quality-edit">{day.avgEditIntensity}% edit</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Replace quality KPI cards**

In the `Calidad y satisfaccion` section, replace the four existing `KpiCard` calls with:

```tsx
                <KpiCard
                  label="Enviado sin editar"
                  value={`${data.sendQuality.sentWithoutEditRate}%`}
                  sub={`${data.sendQuality.approvedSent} de ${data.sendQuality.sentTotal} enviados`}
                  tone={data.sendQuality.sentWithoutEditRate >= 70 ? 'ok' : data.sendQuality.sentWithoutEditRate >= 50 ? 'warning' : 'error'}
                />
                <KpiCard
                  label="Editado antes de enviar"
                  value={`${data.sendQuality.editedBeforeSendRate}%`}
                  sub={`${data.sendQuality.editedSent} de ${data.sendQuality.sentTotal} enviados`}
                  tone={data.sendQuality.editedBeforeSendRate > 50 ? 'warning' : undefined}
                />
                <KpiCard
                  label="Intensidad de edicion"
                  value={`${data.sendQuality.avgEditIntensityEdited}%`}
                  sub="promedio sobre editados"
                  tone={data.sendQuality.avgEditIntensityEdited > 45 ? 'warning' : data.sendQuality.avgEditIntensityEdited <= 20 ? 'ok' : undefined}
                />
                <KpiCard
                  label="Casos sensibles"
                  value={`${data.sensitiveRate}%`}
                  sub="riesgo real o escalados"
                  tone={data.sensitiveRate > 30 ? 'warning' : undefined}
                />
```

- [ ] **Step 4: Add the daily quality panel**

After the quality KPI section, add:

```tsx
            <section className="db-section panel">
              <h2 className="db-section-title">Calidad diaria por fecha de envio</h2>
              {data.qualityBySendDay.some((day) => day.sentTotal > 0) ? (
                <QualityTrend data={data.qualityBySendDay} />
              ) : (
                <div className="empty-state">Sin respuestas enviadas en este periodo.</div>
              )}
            </section>
```

- [ ] **Step 5: Update labeling cards**

In `Motivos y etiquetado`, update the first two cards:

```tsx
                <KpiCard
                  label="Etiqueta cerrada"
                  value={`${data.labelingQuality.closedLabelRate}%`}
                  sub={`${data.labelingQuality.closedLabelCount} de ${data.labelingQuality.eligibleForRouting} elegibles`}
                  tone={data.labelingQuality.closedLabelRate >= 80 ? 'ok' : data.labelingQuality.closedLabelRate >= 50 ? 'warning' : 'error'}
                />
                <KpiCard
                  label="Sentimiento analizado"
                  value={`${data.sentimentQuality.sentimentCoverage}%`}
                  sub={`${data.sentimentQuality.sentimentAnalyzed} de ${data.sentimentQuality.eligibleForSentiment} elegibles`}
                  tone={data.sentimentQuality.sentimentCoverage >= 80 ? 'ok' : data.sentimentQuality.sentimentCoverage >= 50 ? 'warning' : 'error'}
                />
```

Replace one lower-value card or add context in existing cards:

```tsx
                <KpiCard
                  label="Sin etiqueta nueva"
                  value={data.labelingQuality.newUnlabeledCount}
                  sub="requiere revisar router"
                  tone={data.labelingQuality.newUnlabeledCount > 0 ? 'warning' : 'ok'}
                />
                <KpiCard
                  label="Historico sin clasificar"
                  value={data.labelingQuality.historicalUnclassifiedCount}
                  sub="fuera del denominador"
                />
```

- [ ] **Step 6: Run type check**

Run:

```bash
npm.cmd exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/dashboard-client.tsx
git commit -m "Show dashboard send quality metrics"
```

---

### Task 5: Add Quality Trend Styles

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add CSS near dashboard metric styles**

Add near the `/* Reason and sentiment metrics */` area:

```css
.db-quality-trend {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  gap: 10px;
  min-height: 170px;
  align-items: end;
}

.db-quality-day {
  display: grid;
  gap: 6px;
  justify-items: center;
  color: var(--ink-soft);
  font-size: 12px;
}

.db-quality-bars {
  height: 96px;
  width: 34px;
  display: flex;
  align-items: end;
  justify-content: center;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}

.db-quality-bar {
  width: 14px;
  min-height: 4px;
  border-radius: 4px 4px 0 0;
}

.db-quality-approved {
  background: var(--gummy-teal);
}

.db-quality-edited {
  background: var(--gummy-blue);
}

.db-quality-date,
.db-quality-edit {
  white-space: nowrap;
}

.db-quality-rate {
  color: var(--ink);
  font-size: 13px;
}
```

- [ ] **Step 2: Run type check**

Run:

```bash
npm.cmd exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "Style dashboard quality trend"
```

---

### Task 6: Add Test Script Entry and Run Full Validation

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add dashboard-quality test to package script**

In `package.json`, update the `test` script to include:

```text
src/lib/dashboard-quality.test.ts
```

Place it near `src/lib/status.test.ts`.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm.cmd exec vitest run --environment node src/lib/dashboard-quality.test.ts src/lib/status.test.ts src/lib/tickets.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm.cmd test
```

Expected: PASS.

- [ ] **Step 4: Run TypeScript**

Run:

```bash
npm.cmd exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Try production build**

Run:

```bash
npm.cmd run build
```

Expected: PASS if Prisma can regenerate. If it fails with `EPERM` on `query_engine-windows.dll.node`, document it as an environment file-lock issue and do not change code for it.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "Add dashboard quality tests to suite"
```

---

### Task 7: Final Review and Push

**Files:**
- Review only committed changes from this plan.

- [ ] **Step 1: Confirm no unrelated files are staged**

Run:

```bash
git status --short
```

Expected: only pre-existing unrelated dirty files remain, such as `scripts/wipe-tickets.ts`, `src/lib/bot-knowledge.ts`, `src/lib/bot-knowledge.test.ts`, `src/data/`, and `tsconfig.tsbuildinfo`.

- [ ] **Step 2: Review commit history**

Run:

```bash
git log --oneline -6
```

Expected: plan commits appear above the previous `Document dashboard quality metrics redesign` commit.

- [ ] **Step 3: Push**

Run:

```bash
git push origin main
```

Expected: push succeeds.

- [ ] **Step 4: Report validation**

Final report should include:

- commit hashes pushed
- tests run and results
- whether build passed or was blocked by Prisma DLL `EPERM`
- reminder that unrelated dirty files were not touched

---

## Self-Review Notes

- Spec coverage: send-date metrics, edit intensity, sensitive cases, labeling eligibility, sentiment eligibility, audit metadata, UI, and tests are covered.
- Placeholder scan: no unfinished-marker or vague delayed-work steps remain.
- Type consistency: API fields are defined once in `DashboardData` and mirrored in the pure helper return types.
- Scope: no database migration and no n8n workflow changes are included, matching the spec.

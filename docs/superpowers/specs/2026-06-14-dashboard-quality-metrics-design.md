# Dashboard Quality Metrics Design

## Goal

Improve the support dashboard quality metrics so the team can see, by send date, how much of the bot output is being sent without edits, how much is edited before sending, and how intense those edits are. The change must also correct misleading quality cards caused by old or incomplete classification data.

## Current Problems

- `Precision IA` is currently calculated from all tickets in the selected received-date period. This does not answer "how are we doing today sending replies?" because a reply can be sent on a different day than it was received.
- `Casos sensibles` currently treats any non-null `riskFlags` value as active. Empty strings or legacy values can inflate this metric, including false `100%` readings.
- `Sin etiqueta cerrada` is currently `total tickets - tickets with routedTemplateId`. That mixes genuinely unclassified new tickets with older tickets created before the newer routing/sentiment logic existed.
- `Sentimiento analizado` uses all tickets in the period as denominator, so historical tickets that were never eligible for sentiment make current coverage look worse than it is.
- The dashboard does not show how much humans edited a generated reply before sending it.

## Metric Definitions

All send-quality metrics use `sentAt`, not `receivedAt`.

### Sent Without Editing

Denominator: tickets with `status IN ('approved_sent', 'edited_sent')` and `sentAt` inside the selected period.

Numerator: tickets with `status = 'approved_sent'`.

Metric:

```text
sentWithoutEditRate = approved_sent / (approved_sent + edited_sent)
```

This replaces the current `Precision IA` interpretation.

### Edited Before Sending

Denominator: same sent tickets denominator.

Numerator: tickets with `status = 'edited_sent'`.

Metric:

```text
editedBeforeSendRate = edited_sent / (approved_sent + edited_sent)
```

### Edit Intensity

For each sent ticket with an AI draft and a final reply, compare normalized `aiReply` against normalized `finalReply`.

Use a bounded string-difference metric:

```text
editIntensity = editDistance(aiReply, finalReply) / max(length(aiReply), length(finalReply), 1)
```

The dashboard displays:

- average edit intensity for edited sent tickets
- optional average edit intensity for all sent tickets, where unedited messages count as 0
- daily trend by `sentAt`

The implementation can compute this at query time for historical tickets and store it in `AuditEvent.metadataJson` for new sends.

### Sensitive Cases

Count a ticket as sensitive only when:

- `escalationRecommended = true`, or
- `riskFlags` contains a non-empty meaningful value after trimming.

The denominator remains tickets received in the selected period unless a dedicated send-quality section is used. Empty strings and whitespace do not count as active risk flags.

### Closed Label Coverage

Split missing labels into two concepts:

- `Sin etiqueta nueva`: tickets in the selected period that are eligible for the current router but have no `routedTemplateId`.
- `Historico sin clasificar`: tickets that predate the new routing/sentiment instrumentation or have no `routeSource` and no `caseReasoningJson`.

Closed label rate should use eligible tickets as denominator:

```text
closedLabelRate = routedTemplateId count / eligibleForRouting count
```

The dashboard can still show historical unclassified volume as context, but it should not punish the current metric.

### Sentiment Coverage

Sentiment coverage should use eligible tickets as denominator:

```text
sentimentCoverage = tickets with sentiment / eligibleForSentiment count
```

Eligibility can be inferred from route/source instrumentation:

- `routeSource IS NOT NULL`, or
- `caseReasoningJson IS NOT NULL`, or
- `sentimentSource IS NOT NULL`, or
- `receivedAt` is after a configured rollout date.

The first implementation should avoid hardcoding a fragile rollout date if current fields can infer eligibility.

## Dashboard Changes

### Quality Section

Replace or rename the current quality cards:

- `Enviado sin editar`
  - shows `sentWithoutEditRate`
  - subtext: `X de Y enviados`
- `Editado antes de enviar`
  - shows `editedBeforeSendRate`
  - subtext: `X de Y enviados`
- `Intensidad de edicion`
  - shows average edit intensity
  - subtext: `promedio sobre editados`
- `Casos sensibles`
  - corrected risk count
  - subtext distinguishes `riesgo real/escalados`

### Daily Quality Trend

Add a panel for daily send-quality by `sentAt`.

Each day should include:

- date
- sent total
- sent without edit count
- edited sent count
- sent without edit percent
- edited percent
- average edit intensity

The UI can start as compact bars with labels; a richer chart can come later.

### Labeling Section

Change labels to make the data honest:

- `Etiqueta cerrada`: percent of eligible tickets, not all tickets.
- `Sin etiqueta nueva`: current unclassified tickets that should be acted on.
- `Historico sin clasificar`: older/legacy tickets excluded from the quality denominator.
- `Sentimiento analizado`: percent of sentiment-eligible tickets.

## Data Flow

The dashboard API should return both existing fields and new fields to keep the UI change incremental:

```ts
qualityBySendDay: Array<{
  date: string;
  sentTotal: number;
  approvedSent: number;
  editedSent: number;
  sentWithoutEditRate: number;
  editedBeforeSendRate: number;
  avgEditIntensity: number;
}>;

sendQuality: {
  sentTotal: number;
  approvedSent: number;
  editedSent: number;
  sentWithoutEditRate: number;
  editedBeforeSendRate: number;
  avgEditIntensityEdited: number;
  avgEditIntensityAll: number;
};

labelingQuality: {
  eligibleForRouting: number;
  closedLabelCount: number;
  newUnlabeledCount: number;
  historicalUnclassifiedCount: number;
  closedLabelRate: number;
};

sentimentQuality: {
  eligibleForSentiment: number;
  sentimentAnalyzed: number;
  sentimentCoverage: number;
};
```

## Backward Compatibility

- Existing dashboard fields can remain during the transition so the UI does not break.
- Historical edit intensity can be computed from `aiReply` and `finalReply`.
- New send actions should add edit metrics to `AuditEvent.metadataJson`, but dashboards should not depend exclusively on the audit event because old tickets do not have it.
- No n8n workflow changes are required for this feature.

## Error Handling

- If a ticket has no `finalReply`, use `aiReply` for unedited sent tickets and skip intensity for invalid edited rows.
- If both texts are empty, intensity is `0`.
- If there are no sent tickets in the selected period, rates are `0` and the UI says `0 de 0 enviados`.
- Empty or whitespace-only `riskFlags` are treated as no risk.

## Testing

Add focused tests for:

- daily send quality grouped by `sentAt`
- sent without edit and edited rates
- edit intensity for identical, lightly edited, and heavily edited replies
- risk flag trimming
- label denominator excluding historical unclassified tickets
- sentiment denominator excluding historical ineligible tickets

Existing dashboard tests should continue passing.

## Out of Scope

- Reclassifying old tickets in bulk.
- Adding new database columns for edit metrics.
- Changing n8n send workflows.
- Changing ticket send behavior or webmail delivery.

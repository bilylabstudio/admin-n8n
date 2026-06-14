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
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j];
  }

  return previous[b.length];
}

export function editIntensity(
  aiReply: string | null | undefined,
  finalReply: string | null | undefined
): number {
  const original = normalizeDashboardText(aiReply);
  const final = normalizeDashboardText(finalReply);
  const denominator = Math.max(original.length, final.length, 1);
  return Math.min(1, Math.round((levenshtein(original, final) / denominator) * 100) / 100);
}

function sentTickets(tickets: SendQualityTicket[]): SendQualityTicket[] {
  return tickets.filter((ticket) => ticket.sentAt && ['approved_sent', 'edited_sent'].includes(ticket.status));
}

function averagePercent(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100);
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

import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  buildQualityBySendDay,
  hasMeaningfulRiskFlag,
  percent,
  summarizeLabelingQuality,
  summarizeSendQuality,
  summarizeSentimentQuality
} from '@/lib/dashboard-quality';
import {
  FAMILY_LABELS,
  SENTIMENT_LABELS,
  routeSourceLabel,
  templateFamily,
  templateLabelFor,
  type SentimentValue,
  type TemplateFamily
} from '@/lib/template-labels';

export const dynamic = 'force-dynamic';

type RawRow = { date: Date; count: bigint };
type RawAvgRow = { date: Date; avgMinutes: number | null };
type ReasonAccumulator = {
  family: TemplateFamily;
  familyLabel: string;
  count: number;
  reasons: Array<{ id: string | null; label: string; count: number; percentOfTotal: number }>;
};

const SENTIMENT_VALUES: SentimentValue[] = ['molesto', 'neutral', 'contento'];

function days(period: string): number {
  if (period === '30d') return 30;
  if (period === '90d') return 90;
  return 7;
}

function fillDays(rows: { date: string; count: number }[], d: number): { date: string; count: number }[] {
  const map = new Map(rows.map((r) => [r.date, r.count]));
  const result: { date: string; count: number }[] = [];
  for (let i = d - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    result.push({ date: key, count: map.get(key) ?? 0 });
  }
  return result;
}

function isSentiment(value: string | null): value is SentimentValue {
  return SENTIMENT_VALUES.includes(value as SentimentValue);
}

function emptySentimentCounts(): Record<SentimentValue, number> {
  return { molesto: 0, neutral: 0, contento: 0 };
}

function addReason(
  groups: Map<TemplateFamily, ReasonAccumulator>,
  family: TemplateFamily,
  reason: { id: string | null; label: string; count: number; percentOfTotal: number }
) {
  const existing =
    groups.get(family) ??
    {
      family,
      familyLabel: FAMILY_LABELS[family],
      count: 0,
      reasons: []
    };

  existing.count += reason.count;

  // Buscar si ya existe una subcategoría con exactamente el mismo nombre (label)
  const duplicateReason = existing.reasons.find((r) => r.label === reason.label);

  if (duplicateReason) {
    // Si ya existe, le sumamos la cantidad
    duplicateReason.count += reason.count;
  } else {
    // Si no existe, agregamos la nueva subcategoría
    existing.reasons.push(reason);
  }

  groups.set(family, existing);
}
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || '7d';
  const d = days(period);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - d);
  startDate.setHours(0, 0, 0, 0);

  const sendStartDate = new Date();
  sendStartDate.setDate(sendStartDate.getDate() - (d - 1));
  sendStartDate.setHours(0, 0, 0, 0);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    pendingNow,
    pendingTickets,
    receivedToday,
    sendFailed,
    rawVolume,
    rawAvgResponse,
    statusBreakdown,
    rawCategories,
    rawIntents,
    totalInPeriod,
    escalatedInPeriod,
    rawReasons,
    rawRouteSources,
    rawSentiments,
    rawSentimentByFamily,
    sentQualityTickets,
    classificationTickets,
  ] = await Promise.all([
    db.ticket.count({ where: { status: { in: ['pending_review', 'new', 'ai_generated'] } } }),
    db.ticket.findMany({
      where: { status: { in: ['pending_review', 'new', 'ai_generated'] } },
      select: { receivedAt: true },
    }),
    db.ticket.count({ where: { receivedAt: { gte: startOfToday } } }),
    db.ticket.count({ where: { status: 'send_failed' } }),
    db.$queryRaw<RawRow[]>`
      SELECT DATE_TRUNC('day', "receivedAt") AS date, COUNT(*)::bigint AS count
      FROM "Ticket"
      WHERE "receivedAt" >= ${startDate}
      GROUP BY 1 ORDER BY 1 ASC`,
    db.$queryRaw<RawAvgRow[]>`
      SELECT DATE_TRUNC('day', "receivedAt") AS date,
             AVG(EXTRACT(EPOCH FROM ("sentAt" - "receivedAt")) / 60)::float AS "avgMinutes"
      FROM "Ticket"
      WHERE "receivedAt" >= ${startDate} AND "sentAt" IS NOT NULL
      GROUP BY 1 ORDER BY 1 ASC`,
    db.ticket.groupBy({
      by: ['status'],
      _count: { id: true },
      where: { receivedAt: { gte: startDate } },
    }),
    db.ticket.groupBy({
      by: ['category'],
      _count: { id: true },
      where: { receivedAt: { gte: startDate }, category: { not: null } },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    }),
    db.ticket.groupBy({
      by: ['intent'],
      _count: { id: true },
      where: { receivedAt: { gte: startDate }, intent: { not: null } },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    }),
    db.ticket.count({ where: { receivedAt: { gte: startDate } } }),
    db.ticket.count({ where: { receivedAt: { gte: startDate }, escalationRecommended: true } }),
    db.ticket.groupBy({
      by: ['routedTemplateId'],
      _count: { id: true },
      where: { receivedAt: { gte: startDate }, routedTemplateId: { not: null } },
      orderBy: { _count: { id: 'desc' } },
    }),
    db.ticket.groupBy({
      by: ['routeSource'],
      _count: { id: true },
      where: { receivedAt: { gte: startDate }, routeSource: { not: null } },
      orderBy: { _count: { id: 'desc' } },
    }),
    db.ticket.groupBy({
      by: ['sentiment'],
      _count: { id: true },
      where: { receivedAt: { gte: startDate }, sentiment: { not: null } },
      orderBy: { _count: { id: 'desc' } },
    }),
    db.ticket.groupBy({
      by: ['sentiment', 'routedTemplateId', 'category'],
      _count: { id: true },
      where: { receivedAt: { gte: startDate }, sentiment: { not: null } },
    }),
    db.ticket.findMany({
      where: {
        sentAt: { gte: sendStartDate },
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
  ]);

  const avgWaitMinutes =
    pendingTickets.length > 0
      ? pendingTickets.reduce((s, t) => s + (Date.now() - t.receivedAt.getTime()) / 60000, 0) /
        pendingTickets.length
      : 0;

  const volumeByDay = fillDays(
    rawVolume.map((r) => ({ date: r.date.toISOString().slice(0, 10), count: Number(r.count) })),
    d
  );

  const avgResponseByDay = rawAvgResponse.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    avgMinutes: r.avgMinutes != null ? Math.round(r.avgMinutes) : null,
  }));

  const discarded = statusBreakdown.find((s) => s.status === 'discarded')?._count.id ?? 0;
  const sendQuality = summarizeSendQuality(sentQualityTickets);
  const qualityBySendDay = buildQualityBySendDay(sentQualityTickets, sendStartDate, d);
  const labelingQuality = summarizeLabelingQuality(classificationTickets);
  const sentimentQuality = summarizeSentimentQuality(classificationTickets);
  const sensitiveCount = classificationTickets.filter(
    (ticket) => ticket.escalationRecommended || hasMeaningfulRiskFlag(ticket.riskFlags)
  ).length;

  const aiAccuracy = sendQuality.sentWithoutEditRate;
  const abandonRate = totalInPeriod > 0 ? Math.round((discarded / totalInPeriod) * 100) : 0;
  const escalationRate =
    totalInPeriod > 0 ? Math.round((escalatedInPeriod / totalInPeriod) * 100) : 0;
  const sensitiveRate = percent(sensitiveCount, totalInPeriod);
  const closedReasonTotal = rawReasons.reduce((sum, reason) => sum + reason._count.id, 0);
  const reasonDenominator = Math.max(closedReasonTotal, 1);
  const reasonGroups = new Map<TemplateFamily, ReasonAccumulator>();

  for (const reason of rawReasons) {
    const metadata = templateLabelFor(reason.routedTemplateId);
    addReason(reasonGroups, metadata.family, {
      id: reason.routedTemplateId,
      label: metadata.label,
      count: reason._count.id,
      percentOfTotal: percent(reason._count.id, reasonDenominator)
    });
  }

  const routeSourceCount = rawRouteSources.reduce((sum, source) => sum + source._count.id, 0);
  const missingRouteSourceCount = Math.max(totalInPeriod - routeSourceCount, 0);

  const sentimentCounts = emptySentimentCounts();
  for (const row of rawSentiments) {
    if (isSentiment(row.sentiment)) {
      sentimentCounts[row.sentiment] = row._count.id;
    }
  }
  const sentimentAnalyzed = SENTIMENT_VALUES.reduce((sum, sentiment) => sum + sentimentCounts[sentiment], 0);

  const sentimentFamilyMap = new Map<
    string,
    {
      family: string;
      label: string;
      count: number;
      sentiments: Record<SentimentValue, number>;
    }
  >();

  for (const row of rawSentimentByFamily) {
    if (!isSentiment(row.sentiment)) continue;

    const family = row.routedTemplateId
      ? templateFamily(row.routedTemplateId)
      : row.category
        ? `category:${row.category}`
        : 'sin_etiqueta';
    const label = row.routedTemplateId
      ? FAMILY_LABELS[templateFamily(row.routedTemplateId)]
      : row.category || FAMILY_LABELS.sin_etiqueta;

    const current =
      sentimentFamilyMap.get(family) ?? {
        family,
        label,
        count: 0,
        sentiments: emptySentimentCounts()
      };

    current.count += row._count.id;
    current.sentiments[row.sentiment] += row._count.id;
    sentimentFamilyMap.set(family, current);
  }

  return NextResponse.json({
    ok: true,
    period,
    realtime: {
      pendingNow,
      avgWaitMinutes: Math.round(avgWaitMinutes),
      receivedToday,
      sendFailed,
    },
    volumeByDay,
    avgResponseByDay,
    statusBreakdown: statusBreakdown.map((s) => ({ status: s.status, count: s._count.id })),
    topCategories: rawCategories
      .filter((c) => c.category)
      .map((c) => ({ category: c.category!, count: c._count.id })),
    topIntents: rawIntents
      .filter((i) => i.intent)
      .map((i) => ({ intent: i.intent!, count: i._count.id })),
    reasonsByFamily: Array.from(reasonGroups.values())
      .sort((a, b) => b.count - a.count)
      .map((group) => ({
        family: group.family,
        label: group.familyLabel,
        count: group.count,
        percent: percent(group.count, reasonDenominator),
        topReasons: group.reasons
          .sort((a, b) => b.count - a.count)
          .slice(0, 6)
          .map((reason) => ({
            ...reason,
            percentOfFamily: percent(reason.count, group.count)
          }))
      })),
    routeSourceBreakdown: [
      ...rawRouteSources.map((source) => ({
        source: source.routeSource!,
        label: routeSourceLabel(source.routeSource),
        count: source._count.id,
        percent: percent(source._count.id, totalInPeriod)
      })),
      ...(missingRouteSourceCount > 0
        ? [
            {
              source: null,
              label: routeSourceLabel(null),
              count: missingRouteSourceCount,
              percent: percent(missingRouteSourceCount, totalInPeriod)
            }
          ]
        : [])
    ],
    sendQuality,
    qualityBySendDay,
    labelingQuality,
    sentimentQuality,
    closedLabelRate: labelingQuality.closedLabelRate,
    sentimentBreakdown: SENTIMENT_VALUES.map((sentiment) => ({
      sentiment,
      label: SENTIMENT_LABELS[sentiment],
      count: sentimentCounts[sentiment],
      percent: percent(sentimentCounts[sentiment], sentimentAnalyzed)
    })),
    sentimentCoverage: sentimentQuality.sentimentCoverage,
    sentimentByFamily: Array.from(sentimentFamilyMap.values())
      .map((group) => ({
        family: group.family,
        label: group.label,
        count: group.count,
        molesto: group.sentiments.molesto,
        neutral: group.sentiments.neutral,
        contento: group.sentiments.contento,
        molestoPercent: percent(group.sentiments.molesto, group.count),
        neutralPercent: percent(group.sentiments.neutral, group.count),
        contentoPercent: percent(group.sentiments.contento, group.count)
      }))
      .sort((a, b) => b.molestoPercent - a.molestoPercent || b.count - a.count)
      .slice(0, 8),
    totalInPeriod,
    aiAccuracy,
    abandonRate,
    escalationRate,
    sensitiveRate,
    serverTime: new Date().toISOString(),
  });
}

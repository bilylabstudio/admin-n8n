import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RawRow = { date: Date; count: bigint };
type RawAvgRow = { date: Date; avgMinutes: number | null };

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

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || '7d';
  const d = days(period);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - d);
  startDate.setHours(0, 0, 0, 0);

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
    sensitiveInPeriod,
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
    db.ticket.count({
      where: {
        receivedAt: { gte: startDate },
        OR: [{ riskFlags: { not: null } }, { escalationRecommended: true }],
      },
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

  const approvedSent = statusBreakdown.find((s) => s.status === 'approved_sent')?._count.id ?? 0;
  const editedSent = statusBreakdown.find((s) => s.status === 'edited_sent')?._count.id ?? 0;
  const discarded = statusBreakdown.find((s) => s.status === 'discarded')?._count.id ?? 0;

  const aiAccuracy =
    approvedSent + editedSent > 0 ? Math.round((approvedSent / (approvedSent + editedSent)) * 100) : 0;
  const abandonRate = totalInPeriod > 0 ? Math.round((discarded / totalInPeriod) * 100) : 0;
  const escalationRate =
    totalInPeriod > 0 ? Math.round((escalatedInPeriod / totalInPeriod) * 100) : 0;
  const sensitiveRate =
    totalInPeriod > 0 ? Math.round((sensitiveInPeriod / totalInPeriod) * 100) : 0;

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
    totalInPeriod,
    aiAccuracy,
    abandonRate,
    escalationRate,
    sensitiveRate,
    serverTime: new Date().toISOString(),
  });
}

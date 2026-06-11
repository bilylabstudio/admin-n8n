import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { aggregate, resolveSalesDateRange, viewSyncState } from '@/lib/sales';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  await requireUser();

  const url = new URL(request.url);
  const platformParam = url.searchParams.get('platform') || 'all';
  const range = resolveSalesDateRange({
    periodParam: url.searchParams.get('period'),
    startParam: url.searchParams.get('start'),
    endParam: url.searchParams.get('end')
  });

  if (!range.ok) {
    return Response.json({ ok: false, error: range.error }, { status: 400 });
  }

  const where = {
    processedAt: { gte: range.since, lte: range.until },
    cancelledAt: null,
    isTest: false,
    ...(platformParam !== 'all' ? { platform: platformParam } : {})
  };

  const [orders, syncState] = await Promise.all([
    db.platformOrder.findMany({
      where,
      select: {
        platform: true,
        processedAt: true,
        financialStatus: true,
        totalPrice: true,
        totalRefunded: true,
        totalUnits: true,
        currency: true
      }
    }),
    db.platformSyncState.findMany()
  ]);

  const { kpis, byDay, byPlatform } =
    range.period === 'ytd'
      ? aggregate(orders)
      : aggregate(orders, { since: range.since, until: range.until });

  return Response.json({
    ok: true,
    period: range.period,
    platform: platformParam,
    since: range.since.toISOString(),
    until: range.until.toISOString(),
    startDate: range.startDate,
    endDate: range.endDate,
    syncState: viewSyncState(syncState),
    kpis,
    byDay,
    byPlatform
  });
}

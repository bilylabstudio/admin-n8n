import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { aggregate, isPeriod, sinceForPeriod, viewSyncState, type Period } from '@/lib/sales';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  await requireUser();

  const url = new URL(request.url);
  const periodParam = url.searchParams.get('period');
  const period: Period = isPeriod(periodParam) ? periodParam : 'ytd';
  const platformParam = url.searchParams.get('platform') || 'all';

  const since = sinceForPeriod(period);
  const until = new Date();

  const where = {
    processedAt: { gte: since, lte: until },
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

  const { kpis, byDay, byPlatform } = aggregate(orders);

  return Response.json({
    ok: true,
    period,
    platform: platformParam,
    since: since.toISOString(),
    until: until.toISOString(),
    syncState: viewSyncState(syncState),
    kpis,
    byDay,
    byPlatform
  });
}

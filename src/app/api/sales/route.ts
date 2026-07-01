import { db } from '@/lib/db';
import { requireSalesApiAccess } from '@/lib/sales-auth';
import { aggregate, chartGranularityForRange, resolveSalesDateRange, viewSyncState } from '@/lib/sales';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const accessError = await requireSalesApiAccess();
  if (accessError) return accessError;

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

  const [orders, financialTransactions, marketingSpend, syncState] = await Promise.all([
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
    db.platformFinancialTransaction.findMany({
      where: {
        postedAt: { gte: range.since, lte: range.until },
        ...(platformParam !== 'all' ? { platform: platformParam } : {})
      },
      select: {
        platform: true,
        provider: true,
        grossAmount: true,
        feeAmount: true,
        netAmount: true,
        currency: true,
        postedAt: true
      }
    }),
    db.platformMarketingSpend.findMany({
      where: {
        date: { gte: range.since, lte: range.until },
        ...(platformParam !== 'all' ? { platform: platformParam } : {})
      },
      select: {
        platform: true,
        provider: true,
        spendAmount: true,
        attributedSalesAmount: true,
        currency: true,
        date: true
      }
    }),
    db.platformSyncState.findMany()
  ]);

  const chartGranularity = chartGranularityForRange(range.since, range.until);
  const { kpis, financeKpis, byDay, byPlatform, byPlatformFinancial, byFinancialStatus } = aggregate(orders, {
    since: range.since,
    until: range.until,
    granularity: chartGranularity,
    financialTransactions,
    marketingSpend
  });

  return Response.json({
    ok: true,
    period: range.period,
    platform: platformParam,
    since: range.since.toISOString(),
    until: range.until.toISOString(),
    startDate: range.startDate,
    endDate: range.endDate,
    chartGranularity,
    syncState: viewSyncState(syncState),
    kpis,
    financeKpis,
    byDay,
    byPlatform,
    byPlatformFinancial,
    byFinancialStatus
  });
}

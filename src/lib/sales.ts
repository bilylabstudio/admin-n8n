import type { PlatformOrder, PlatformSyncState } from '@prisma/client';

export type Period = 'ytd' | '7d' | '30d' | '90d';
export type SalesPeriod = Period | 'custom';

export type SalesKpis = {
  grossRevenue: number;
  netRevenue: number;
  totalOrders: number;
  refundedOrders: number;
  refundRate: number;
  totalUnits: number;
  unitsPerOrder: number;
  aov: number;
  currency: string;
};

export type SalesFinancialKpis = {
  totalFees: number;
  feeRate: number;
  netAfterFees: number;
  totalAdSpend: number;
  adSpendRate: number;
  blendedRoas: number | null;
  attributedAdSales: number;
  attributedRoas: number | null;
  netAfterFeesAndAds: number;
  coveredRevenue: number;
  coverageRate: number;
};

export type SalesPlatformFinancialBreakdown = {
  platform: string;
  orders: number;
  grossRevenue: number;
  refundedRevenue: number;
  netRevenue: number;
  salesMix: number;
  feeAmount: number;
  feeRate: number;
  netAfterFees: number;
  adSpend: number;
  adSpendRate: number;
  attributedAdSales: number;
  attributedRoas: number | null;
  mer: number | null;
  netAfterFeesAndAds: number;
  hasFeeData: boolean;
  feeProviders: string[];
  hasMarketingData: boolean;
  marketingProviders: string[];
};

export type SalesFinancialStatusBreakdown = {
  status: string;
  orders: number;
  grossRevenue: number;
  refundedRevenue: number;
  netRevenue: number;
  units: number;
};

export type SyncStateView = {
  platform: string;
  lastSyncRunAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  ordersImported: number;
};

export type SalesResponse = {
  ok: true;
  period: SalesPeriod;
  platform: string;
  since: string;
  until: string;
  startDate: string;
  endDate: string;
  chartGranularity: ChartGranularity;
  syncState: SyncStateView[];
  kpis: SalesKpis;
  financeKpis: SalesFinancialKpis;
  byDay: Array<{ date: string; orders: number; revenue: number; units: number }>;
  byPlatform: Array<{ platform: string; orders: number; revenue: number }>;
  byPlatformFinancial: SalesPlatformFinancialBreakdown[];
  byFinancialStatus: SalesFinancialStatusBreakdown[];
};

export type AggregateInput = Pick<
  PlatformOrder,
  'platform' | 'processedAt' | 'financialStatus' | 'totalPrice' | 'totalRefunded' | 'totalUnits' | 'currency'
>;

export type AggregateFinancialTransactionInput = {
  platform: string;
  provider: string;
  grossAmount: unknown;
  feeAmount: unknown;
  netAmount: unknown;
  currency: string;
  postedAt: Date;
};

export type AggregateMarketingSpendInput = {
  platform: string;
  provider: string;
  spendAmount: unknown;
  attributedSalesAmount: unknown;
  currency: string;
  date: Date;
};

export type AggregateOptions = {
  since?: Date;
  until?: Date;
  granularity?: ChartGranularity;
  financialTransactions?: AggregateFinancialTransactionInput[];
  marketingSpend?: AggregateMarketingSpendInput[];
};

export type ChartGranularity = 'day' | 'month';

export function isPeriod(value: string | null | undefined): value is Period {
  return value === 'ytd' || value === '7d' || value === '30d' || value === '90d';
}

export function sinceForPeriod(period: Period, now: Date = new Date()): Date {
  if (period === 'ytd') {
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export type SalesDateRange =
  | {
      ok: true;
      period: SalesPeriod;
      since: Date;
      until: Date;
      startDate: string;
      endDate: string;
    }
  | { ok: false; error: string };

export function resolveSalesDateRange(input: {
  periodParam?: string | null;
  startParam?: string | null;
  endParam?: string | null;
  now?: Date;
}): SalesDateRange {
  const now = input.now ?? new Date();
  const startParam = input.startParam?.trim() || null;
  const endParam = input.endParam?.trim() || null;

  if (startParam || endParam) {
    if (!startParam || !endParam) {
      return { ok: false, error: 'Debes enviar fecha inicio y fecha final.' };
    }

    const since = parseDateInput(startParam, 'start');
    const until = parseDateInput(endParam, 'end');
    if (!since || !until) {
      return { ok: false, error: 'Formato de fecha invalido. Usa YYYY-MM-DD.' };
    }
    if (since.getTime() > until.getTime()) {
      return { ok: false, error: 'La fecha inicio no puede ser posterior a la fecha final.' };
    }

    return {
      ok: true,
      period: 'custom',
      since,
      until,
      startDate: startParam,
      endDate: endParam
    };
  }

  const period: Period = isPeriod(input.periodParam) ? input.periodParam : 'ytd';
  const since = sinceForPeriod(period, now);
  return {
    ok: true,
    period,
    since,
    until: now,
    startDate: dateInputFromDate(since),
    endDate: dateInputFromDate(now)
  };
}

export function aggregate(orders: AggregateInput[], options: AggregateOptions = {}): {
  kpis: SalesKpis;
  financeKpis: SalesFinancialKpis;
  byDay: SalesResponse['byDay'];
  byPlatform: SalesResponse['byPlatform'];
  byPlatformFinancial: SalesResponse['byPlatformFinancial'];
  byFinancialStatus: SalesResponse['byFinancialStatus'];
} {
  const totalOrders = orders.length;
  const financialTransactions = options.financialTransactions ?? [];
  const marketingSpend = options.marketingSpend ?? [];

  const grossRevenue = sum(orders, (o) => toNumber(o.totalPrice));
  const totalRefunded = sum(orders, (o) => toNumber(o.totalRefunded));
  const netRevenue = grossRevenue - totalRefunded;

  const refundedOrders = orders.filter(
    (o) =>
      toNumber(o.totalRefunded) > 0 ||
      o.financialStatus === 'refunded' ||
      o.financialStatus === 'partially_refunded'
  ).length;
  const refundRate = totalOrders ? (refundedOrders / totalOrders) * 100 : 0;

  const totalUnits = sum(orders, (o) => o.totalUnits);
  const unitsPerOrder = totalOrders ? totalUnits / totalOrders : 0;
  const aov = totalOrders ? grossRevenue / totalOrders : 0;

  const currency = mostCommon(orders.map((o) => o.currency)) || 'EUR';
  const granularity = options.granularity ?? 'day';

  const byDayMap = new Map<string, { orders: number; revenue: number; units: number }>();
  for (const o of orders) {
    const date = bucketKey(o.processedAt, granularity);
    const cur = byDayMap.get(date) || { orders: 0, revenue: 0, units: 0 };
    cur.orders += 1;
    cur.revenue += toNumber(o.totalPrice);
    cur.units += o.totalUnits;
    byDayMap.set(date, cur);
  }
  const byDay =
    options.since && options.until
      ? fillDateRange(options.since, options.until, byDayMap, granularity)
      : [...byDayMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, v]) => ({ date, orders: v.orders, revenue: round2(v.revenue), units: v.units }));

  const byPlatformMap = new Map<string, { orders: number; revenue: number }>();
  for (const o of orders) {
    const cur = byPlatformMap.get(o.platform) || { orders: 0, revenue: 0 };
    cur.orders += 1;
    cur.revenue += toNumber(o.totalPrice);
    byPlatformMap.set(o.platform, cur);
  }
  const byPlatform = [...byPlatformMap.entries()]
    .sort(([, a], [, b]) => b.revenue - a.revenue)
    .map(([platform, v]) => ({ platform, orders: v.orders, revenue: round2(v.revenue) }));

  const byPlatformFinancial = aggregatePlatformFinancials(orders, financialTransactions, marketingSpend);
  const totalFees = sum(financialTransactions, (transaction) => toNumber(transaction.feeAmount));
  const totalAdSpend = sum(marketingSpend, (record) => toNumber(record.spendAmount));
  const attributedAdSales = sum(marketingSpend, (record) => toNumber(record.attributedSalesAmount));
  const netAfterFees = netRevenue - totalFees;
  const netAfterFeesAndAds = netAfterFees - totalAdSpend;
  const coveredRevenue = sum(
    byPlatformFinancial.filter((row) => row.hasFeeData),
    (row) => row.netRevenue
  );
  const coverageRate = netRevenue ? (coveredRevenue / netRevenue) * 100 : 0;
  const feeRate = netRevenue ? (totalFees / netRevenue) * 100 : 0;
  const adSpendRate = netRevenue ? (totalAdSpend / netRevenue) * 100 : 0;
  const blendedRoas = totalAdSpend ? netRevenue / totalAdSpend : null;
  const attributedRoas = totalAdSpend ? attributedAdSales / totalAdSpend : null;

  const byFinancialStatusMap = new Map<string, SalesFinancialStatusBreakdown>();
  for (const o of orders) {
    const status = normalizeFinancialStatus(o.financialStatus);
    const grossRevenue = toNumber(o.totalPrice);
    const refundedRevenue = toNumber(o.totalRefunded);
    const cur = byFinancialStatusMap.get(status) || {
      status,
      orders: 0,
      grossRevenue: 0,
      refundedRevenue: 0,
      netRevenue: 0,
      units: 0
    };
    cur.orders += 1;
    cur.grossRevenue += grossRevenue;
    cur.refundedRevenue += refundedRevenue;
    cur.netRevenue += grossRevenue - refundedRevenue;
    cur.units += o.totalUnits;
    byFinancialStatusMap.set(status, cur);
  }
  const byFinancialStatus = [...byFinancialStatusMap.values()]
    .sort((a, b) => financialStatusSortOrder(a.status) - financialStatusSortOrder(b.status) || b.grossRevenue - a.grossRevenue)
    .map((v) => ({
      ...v,
      grossRevenue: round2(v.grossRevenue),
      refundedRevenue: round2(v.refundedRevenue),
      netRevenue: round2(v.netRevenue)
    }));

  return {
    kpis: {
      grossRevenue: round2(grossRevenue),
      netRevenue: round2(netRevenue),
      totalOrders,
      refundedOrders,
      refundRate: round2(refundRate),
      totalUnits,
      unitsPerOrder: round2(unitsPerOrder),
      aov: round2(aov),
      currency
    },
    financeKpis: {
      totalFees: round2(totalFees),
      feeRate: round2(feeRate),
      netAfterFees: round2(netAfterFees),
      totalAdSpend: round2(totalAdSpend),
      adSpendRate: round2(adSpendRate),
      blendedRoas: roundNullable2(blendedRoas),
      attributedAdSales: round2(attributedAdSales),
      attributedRoas: roundNullable2(attributedRoas),
      netAfterFeesAndAds: round2(netAfterFeesAndAds),
      coveredRevenue: round2(coveredRevenue),
      coverageRate: round2(coverageRate)
    },
    byDay,
    byPlatform,
    byPlatformFinancial,
    byFinancialStatus
  };
}

function aggregatePlatformFinancials(
  orders: AggregateInput[],
  financialTransactions: AggregateFinancialTransactionInput[],
  marketingSpend: AggregateMarketingSpendInput[]
): SalesPlatformFinancialBreakdown[] {
  const salesByPlatform = new Map<
    string,
    { orders: number; grossRevenue: number; refundedRevenue: number; netRevenue: number }
  >();

  for (const order of orders) {
    const grossRevenue = toNumber(order.totalPrice);
    const refundedRevenue = toNumber(order.totalRefunded);
    const current = salesByPlatform.get(order.platform) || {
      orders: 0,
      grossRevenue: 0,
      refundedRevenue: 0,
      netRevenue: 0
    };
    current.orders += 1;
    current.grossRevenue += grossRevenue;
    current.refundedRevenue += refundedRevenue;
    current.netRevenue += grossRevenue - refundedRevenue;
    salesByPlatform.set(order.platform, current);
  }

  const feesByPlatform = new Map<
    string,
    { feeAmount: number; transactions: number; providers: Set<string> }
  >();

  for (const transaction of financialTransactions) {
    const current = feesByPlatform.get(transaction.platform) || {
      feeAmount: 0,
      transactions: 0,
      providers: new Set<string>()
    };
    current.feeAmount += toNumber(transaction.feeAmount);
    current.transactions += 1;
    current.providers.add(transaction.provider);
    feesByPlatform.set(transaction.platform, current);
  }

  const marketingByPlatform = new Map<
    string,
    { spendAmount: number; attributedSalesAmount: number; records: number; providers: Set<string> }
  >();

  for (const spend of marketingSpend) {
    const current = marketingByPlatform.get(spend.platform) || {
      spendAmount: 0,
      attributedSalesAmount: 0,
      records: 0,
      providers: new Set<string>()
    };
    current.spendAmount += toNumber(spend.spendAmount);
    current.attributedSalesAmount += toNumber(spend.attributedSalesAmount);
    current.records += 1;
    current.providers.add(spend.provider);
    marketingByPlatform.set(spend.platform, current);
  }

  const totalNetRevenue = sum([...salesByPlatform.values()], (row) => row.netRevenue);

  return [...salesByPlatform.entries()]
    .sort(([, a], [, b]) => b.netRevenue - a.netRevenue)
    .map(([platform, sales]) => {
      const feeStats = feesByPlatform.get(platform);
      const feeAmount = feeStats?.feeAmount ?? 0;
      const marketingStats = marketingByPlatform.get(platform);
      const adSpend = marketingStats?.spendAmount ?? 0;
      const attributedAdSales = marketingStats?.attributedSalesAmount ?? 0;
      return {
        platform,
        orders: sales.orders,
        grossRevenue: round2(sales.grossRevenue),
        refundedRevenue: round2(sales.refundedRevenue),
        netRevenue: round2(sales.netRevenue),
        salesMix: round2(totalNetRevenue ? (sales.netRevenue / totalNetRevenue) * 100 : 0),
        feeAmount: round2(feeAmount),
        feeRate: round2(sales.netRevenue ? (feeAmount / sales.netRevenue) * 100 : 0),
        netAfterFees: round2(sales.netRevenue - feeAmount),
        adSpend: round2(adSpend),
        adSpendRate: round2(sales.netRevenue ? (adSpend / sales.netRevenue) * 100 : 0),
        attributedAdSales: round2(attributedAdSales),
        attributedRoas: roundNullable2(adSpend ? attributedAdSales / adSpend : null),
        mer: roundNullable2(adSpend ? sales.netRevenue / adSpend : null),
        netAfterFeesAndAds: round2(sales.netRevenue - feeAmount - adSpend),
        hasFeeData: Boolean(feeStats?.transactions),
        feeProviders: [...(feeStats?.providers ?? new Set<string>())].sort(),
        hasMarketingData: Boolean(marketingStats?.records),
        marketingProviders: [...(marketingStats?.providers ?? new Set<string>())].sort()
      };
    });
}

export function chartGranularityForRange(since: Date, until: Date): ChartGranularity {
  const days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000));
  return days > 62 ? 'month' : 'day';
}

export function viewSyncState(states: PlatformSyncState[]): SyncStateView[] {
  return states.map((s) => ({
    platform: s.platform,
    lastSyncRunAt: s.lastSyncRunAt?.toISOString() ?? null,
    lastSyncStatus: s.lastSyncStatus,
    lastSyncError: s.lastSyncError,
    ordersImported: s.ordersImported
  }));
}

function sum<T>(list: T[], pick: (item: T) => number): number {
  return list.reduce((acc, item) => acc + pick(item), 0);
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as { toNumber: unknown }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value ?? 0);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundNullable2(n: number | null): number | null {
  return n === null ? null : round2(n);
}

function mostCommon<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  const counts = new Map<T, number>();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort(([, a], [, b]) => b - a)[0][0];
}

function fillDateRange(
  since: Date,
  until: Date,
  byDayMap: Map<string, { orders: number; revenue: number; units: number }>,
  granularity: ChartGranularity
): SalesResponse['byDay'] {
  const result: SalesResponse['byDay'] = [];
  const cursor =
    granularity === 'month'
      ? new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1))
      : new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const end =
    granularity === 'month'
      ? new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), 1))
      : new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate()));

  while (cursor.getTime() <= end.getTime()) {
    const date = bucketKey(cursor, granularity);
    const value = byDayMap.get(date) || { orders: 0, revenue: 0, units: 0 };
    result.push({ date, orders: value.orders, revenue: round2(value.revenue), units: value.units });
    if (granularity === 'month') {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return result;
}

function bucketKey(date: Date, granularity: ChartGranularity): string {
  const iso = date.toISOString();
  return granularity === 'month' ? `${iso.slice(0, 7)}-01` : iso.slice(0, 10);
}

function normalizeFinancialStatus(value: string | null | undefined) {
  const normalized = String(value || 'unknown').trim().toLowerCase();
  return normalized || 'unknown';
}

function financialStatusSortOrder(status: string) {
  const order: Record<string, number> = {
    paid: 0,
    pending: 1,
    partially_refunded: 2,
    refunded: 3,
    voided: 4,
    unknown: 99
  };
  return order[status] ?? 50;
}

function parseDateInput(value: string, boundary: 'start' | 'end'): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  if (boundary === 'end') {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function dateInputFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

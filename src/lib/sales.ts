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
  syncState: SyncStateView[];
  kpis: SalesKpis;
  byDay: Array<{ date: string; orders: number; revenue: number; units: number }>;
  byPlatform: Array<{ platform: string; orders: number; revenue: number }>;
};

export type AggregateInput = Pick<
  PlatformOrder,
  'platform' | 'processedAt' | 'financialStatus' | 'totalPrice' | 'totalRefunded' | 'totalUnits' | 'currency'
>;

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

export function aggregate(orders: AggregateInput[]): {
  kpis: SalesKpis;
  byDay: SalesResponse['byDay'];
  byPlatform: SalesResponse['byPlatform'];
} {
  const totalOrders = orders.length;

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

  const byDayMap = new Map<string, { orders: number; revenue: number; units: number }>();
  for (const o of orders) {
    const date = o.processedAt.toISOString().slice(0, 10);
    const cur = byDayMap.get(date) || { orders: 0, revenue: 0, units: 0 };
    cur.orders += 1;
    cur.revenue += toNumber(o.totalPrice);
    cur.units += o.totalUnits;
    byDayMap.set(date, cur);
  }
  const byDay = [...byDayMap.entries()]
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
    byDay,
    byPlatform
  };
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

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as { toNumber: unknown }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value ?? 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mostCommon<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  const counts = new Map<T, number>();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort(([, a], [, b]) => b - a)[0][0];
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

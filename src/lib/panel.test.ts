import { describe, expect, it } from 'vitest';
import {
  buildAlerts,
  buildSeries,
  contributionFor,
  forecastMonth,
  kpisFrom,
  pctChange,
  resolvePanelRange,
  seriesGranularity,
  sumRows,
  todayInMadrid,
  weekStart,
  type DailyPlatformRow
} from './panel';

const NOW = new Date('2026-11-20T09:30:00Z');

function row(partial: Partial<DailyPlatformRow>): DailyPlatformRow {
  return {
    day: '2026-11-01',
    platform: 'shopify',
    orders: 0,
    units: 0,
    grossSales: 0,
    netSales: 0,
    refunded: 0,
    refundedOrders: 0,
    allOrders: 0,
    pendingOrders: 0,
    zeroAmountOrders: 0,
    ...partial
  };
}

describe('todayInMadrid', () => {
  it('uses Madrid local date, not UTC', () => {
    expect(todayInMadrid(new Date('2026-11-20T23:30:00Z'))).toBe('2026-11-21');
    expect(todayInMadrid(new Date('2026-07-31T22:30:00Z'))).toBe('2026-08-01');
  });
});

describe('resolvePanelRange', () => {
  it('defaults to month-to-date compared with the same days of last month', () => {
    const r = resolvePanelRange({ now: NOW });
    expect(r.ok && r.range.current).toEqual({ start: '2026-11-01', end: '2026-11-20' });
    expect(r.ok && r.range.previous).toEqual({ start: '2026-10-01', end: '2026-10-20' });
  });

  it('clamps month-to-date comparison to shorter months', () => {
    const r = resolvePanelRange({ now: new Date('2026-03-31T10:00:00Z') });
    expect(r.ok && r.range.previous).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('resolves last month against the month before', () => {
    const r = resolvePanelRange({ preset: 'last_month', now: NOW });
    expect(r.ok && r.range.current).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(r.ok && r.range.previous).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('resolves rolling windows with an equal previous window', () => {
    const r = resolvePanelRange({ preset: '30d', now: NOW });
    expect(r.ok && r.range.current).toEqual({ start: '2026-10-22', end: '2026-11-20' });
    expect(r.ok && r.range.previous).toEqual({ start: '2026-09-22', end: '2026-10-21' });
  });

  it('compares year-to-date with last year', () => {
    const r = resolvePanelRange({ preset: 'ytd', now: NOW });
    expect(r.ok && r.range.previous).toEqual({ start: '2025-01-01', end: '2025-11-20' });
  });

  it('validates custom ranges', () => {
    expect(resolvePanelRange({ start: '2026-11-10', now: NOW }).ok).toBe(false);
    expect(resolvePanelRange({ start: '2026-11-10', end: '2026-11-01', now: NOW }).ok).toBe(false);
    const r = resolvePanelRange({ start: '2026-11-01', end: '2026-11-10', now: NOW });
    expect(r.ok && r.range.previous).toEqual({ start: '2026-10-22', end: '2026-10-31' });
  });
});

describe('contributionFor', () => {
  const totals = sumRows([row({ orders: 100, units: 150, netSales: 5000, grossSales: 6050 })]);

  it('estimates Shopify fees and product cost from default ledger rates', () => {
    const c = contributionFor('shopify', totals, { feesByPlatform: {}, adsByPlatform: {} }, []);
    // 100 * 0.3 + 5000 * 1.6% = 110 ; 150 * (3.2 + 0.8 + 1.5) = 825
    expect(c.fees).toBe(110);
    expect(c.feesSource).toBe('estimated');
    expect(c.productCost).toBe(825);
    expect(c.contribution).toBe(4065);
    expect(c.adsSource).toBe('missing');
  });

  it('prefers real API fees and ads and honours saved settings', () => {
    const c = contributionFor(
      'shopify',
      totals,
      { feesByPlatform: { shopify: 200 }, adsByPlatform: { shopify: 1000 } },
      [{ platform: 'shopify', key: 'product_cost_unit', value: '4' }, { platform: 'amazon', key: 'product_cost_unit', value: '9' }]
    );
    expect(c.fees).toBe(200);
    expect(c.feesSource).toBe('api');
    expect(c.productCost).toBe(150 * (4 + 0.8 + 1.5));
    expect(c.ads).toBe(1000);
    expect(c.contribution).toBe(5000 - 200 - 945 - 1000);
  });

  it('flags Amazon fees as missing instead of inventing them', () => {
    const c = contributionFor('amazon', totals, { feesByPlatform: {}, adsByPlatform: {} }, []);
    expect(c.feesSource).toBe('missing');
    expect(c.fees).toBe(0);
    expect(c.productCost).toBe(150 * 4.7);
  });

  it('returns null margin rate without sales', () => {
    const c = contributionFor('tiktok_shop', sumRows([]), { feesByPlatform: {}, adsByPlatform: {} }, []);
    expect(c.contributionRate).toBeNull();
  });
});

describe('kpis and deltas', () => {
  it('computes aov and refund rate', () => {
    const k = kpisFrom(sumRows([row({ orders: 90, netSales: 4500, refundedOrders: 10 })]), 1000);
    expect(k.aov).toBe(50);
    expect(k.refundRate).toBe(10);
    expect(k.contributionRate).toBe(22.22);
  });

  it('returns null change when there is no previous value', () => {
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(150, 100)).toBe(50);
  });
});

describe('forecastMonth', () => {
  it('projects using complete days only', () => {
    const daily = Array.from({ length: 20 }, (_, i) => ({
      day: `2026-11-${String(i + 1).padStart(2, '0')}`,
      netSales: i === 19 ? 10 : 1000
    }));
    const f = forecastMonth(daily, '2026-11-20', 25_000)!;
    expect(f.daysElapsed).toBe(19);
    expect(f.netToDate).toBe(19_010);
    expect(f.projectedNet).toBe(30_000);
    expect(f.projectedByLast7).toBe(30_000);
    expect(f.vsPreviousMonth).toBe(20);
  });

  it('is unavailable on the first day of the month', () => {
    expect(forecastMonth([], '2026-12-01', 0)).toBeNull();
  });
});

describe('series', () => {
  it('picks granularity by range length', () => {
    expect(seriesGranularity({ start: '2026-11-01', end: '2026-11-20' })).toBe('day');
    expect(seriesGranularity({ start: '2026-08-01', end: '2026-11-20' })).toBe('week');
    expect(seriesGranularity({ start: '2026-01-01', end: '2026-11-20' })).toBe('month');
  });

  it('fills empty days and groups by platform', () => {
    const points = buildSeries(
      [
        row({ day: '2026-11-01', platform: 'shopify', netSales: 10, orders: 1 }),
        row({ day: '2026-11-01', platform: 'amazon', netSales: 5, orders: 1 }),
        row({ day: '2026-11-03', platform: 'shopify', netSales: 7, orders: 1 })
      ],
      { start: '2026-11-01', end: '2026-11-03' },
      'day'
    );
    expect(points.map((p) => p.key)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(points[0].values).toEqual({ shopify: 10, amazon: 5 });
    expect(points[1].values).toEqual({});
  });

  it('buckets weeks from Monday', () => {
    expect(weekStart('2026-11-20')).toBe('2026-11-16');
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
  });
});

describe('buildAlerts', () => {
  const fresh = (platform: string, lastOrderAt: string | null) => ({
    platform,
    lastOrderAt,
    lastSyncRunAt: lastOrderAt,
    lastSyncStatus: 'ok',
    lastSyncError: null
  });

  it('flags missing channels, zero-amount orders and estimated costs', () => {
    const alerts = buildAlerts({
      today: '2026-11-20',
      now: NOW,
      currentTotals: {
        shopify: sumRows([row({ orders: 500, allOrders: 500, netSales: 20000 })]),
        amazon: sumRows([row({ platform: 'amazon', orders: 100, pendingOrders: 400, allOrders: 500, zeroAmountOrders: 450 })])
      },
      freshness: [fresh('shopify', '2026-11-20T09:00:00Z'), fresh('amazon', '2026-11-20T08:00:00Z'), fresh('tiktok_shop', null)],
      feesByPlatform: {},
      adsByPlatform: {}
    });
    const titles = alerts.map((a) => a.title);
    expect(titles).not.toContain('TikTok Shop: sin datos');
    expect(titles).toContain('Amazon: pedidos sin importe');
    expect(titles).toContain('Amazon: muchos pedidos pendientes');
    expect(titles).toContain('Shopify: comisiones estimadas');
    expect(alerts[0].level).toBe('critical');
    expect(titles).not.toContain('Shopify: pedidos sin importe');
  });

  it('flags stale channels', () => {
    const alerts = buildAlerts({
      today: '2026-11-20',
      now: NOW,
      currentTotals: {},
      freshness: [fresh('shopify', '2026-11-15T09:00:00Z')],
      feesByPlatform: {},
      adsByPlatform: {}
    });
    expect(alerts.map((a) => a.title)).toContain('Shopify: sin pedidos nuevos');
  });
});

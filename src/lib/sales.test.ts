import { describe, expect, it } from 'vitest';
import { aggregate, sinceForPeriod, isPeriod, type RawOrder } from './sales';

function order(partial: Partial<RawOrder> & { processedAt: string | Date }): RawOrder {
  return {
    platform: 'shopify',
    financialStatus: 'paid',
    totalPrice: 100,
    totalRefunded: 0,
    totalUnits: 1,
    currency: 'EUR',
    ...partial
  };
}

describe('sinceForPeriod', () => {
  it('returns Jan 1 UTC of the current year for ytd', () => {
    const now = new Date(Date.UTC(2026, 4, 20));
    expect(sinceForPeriod('ytd', now).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns N days back for 7d/30d/90d', () => {
    const now = new Date(Date.UTC(2026, 4, 20));
    expect(sinceForPeriod('7d', now).toISOString()).toBe('2026-05-13T00:00:00.000Z');
    expect(sinceForPeriod('30d', now).toISOString()).toBe('2026-04-20T00:00:00.000Z');
    expect(sinceForPeriod('90d', now).toISOString()).toBe('2026-02-19T00:00:00.000Z');
  });
});

describe('isPeriod', () => {
  it('accepts only the known values', () => {
    expect(isPeriod('ytd')).toBe(true);
    expect(isPeriod('7d')).toBe(true);
    expect(isPeriod('30d')).toBe(true);
    expect(isPeriod('90d')).toBe(true);
    expect(isPeriod('foo')).toBe(false);
    expect(isPeriod(null)).toBe(false);
    expect(isPeriod(undefined)).toBe(false);
  });
});

describe('aggregate', () => {
  it('returns zeroed KPIs for empty input', () => {
    const { kpis, byDay, byPlatform } = aggregate([]);
    expect(kpis.totalOrders).toBe(0);
    expect(kpis.grossRevenue).toBe(0);
    expect(kpis.netRevenue).toBe(0);
    expect(kpis.aov).toBe(0);
    expect(kpis.unitsPerOrder).toBe(0);
    expect(kpis.currency).toBe('EUR');
    expect(byDay).toEqual([]);
    expect(byPlatform).toEqual([]);
  });

  it('computes gross, net, refund rate, AOV and units/order', () => {
    const orders: RawOrder[] = [
      order({ processedAt: '2026-05-10T10:00:00Z', totalPrice: 100, totalUnits: 2 }),
      order({ processedAt: '2026-05-11T11:00:00Z', totalPrice: 50, totalUnits: 1, totalRefunded: 50, financialStatus: 'refunded' }),
      order({ processedAt: '2026-05-11T12:00:00Z', totalPrice: 200, totalUnits: 5 })
    ];
    const { kpis } = aggregate(orders);
    expect(kpis.totalOrders).toBe(3);
    expect(kpis.grossRevenue).toBe(350);
    expect(kpis.netRevenue).toBe(300);
    expect(kpis.totalUnits).toBe(8);
    expect(kpis.unitsPerOrder).toBe(2.67);
    expect(kpis.aov).toBe(116.67);
    expect(kpis.refundedOrders).toBe(1);
    expect(kpis.refundRate).toBe(33.33);
  });

  it('accepts numeric values delivered as strings (n8n data tables)', () => {
    const orders: RawOrder[] = [
      order({ processedAt: '2026-05-10T10:00:00Z', totalPrice: '49.90' as unknown as number, totalRefunded: '0' as unknown as number, totalUnits: 2 })
    ];
    const { kpis } = aggregate(orders);
    expect(kpis.grossRevenue).toBe(49.9);
    expect(kpis.netRevenue).toBe(49.9);
  });

  it('groups by day with date sorted ascending', () => {
    const orders: RawOrder[] = [
      order({ processedAt: '2026-05-11T11:00:00Z', totalPrice: 50, totalUnits: 1 }),
      order({ processedAt: '2026-05-10T10:00:00Z', totalPrice: 100, totalUnits: 2 }),
      order({ processedAt: '2026-05-11T12:00:00Z', totalPrice: 200, totalUnits: 5 })
    ];
    const { byDay } = aggregate(orders);
    expect(byDay).toEqual([
      { date: '2026-05-10', orders: 1, revenue: 100, units: 2 },
      { date: '2026-05-11', orders: 2, revenue: 250, units: 6 }
    ]);
  });

  it('groups by platform sorted by revenue desc', () => {
    const orders: RawOrder[] = [
      order({ platform: 'shopify', processedAt: '2026-05-10T10:00:00Z', totalPrice: 100 }),
      order({ platform: 'amazon', processedAt: '2026-05-10T11:00:00Z', totalPrice: 500 }),
      order({ platform: 'shopify', processedAt: '2026-05-10T12:00:00Z', totalPrice: 50 })
    ];
    const { byPlatform } = aggregate(orders);
    expect(byPlatform).toEqual([
      { platform: 'amazon', orders: 1, revenue: 500 },
      { platform: 'shopify', orders: 2, revenue: 150 }
    ]);
  });

  it('counts a partially_refunded order as refunded even with refund amount 0', () => {
    const orders: RawOrder[] = [
      order({ processedAt: '2026-05-10T10:00:00Z', financialStatus: 'partially_refunded' }),
      order({ processedAt: '2026-05-11T10:00:00Z', financialStatus: 'paid' })
    ];
    const { kpis } = aggregate(orders);
    expect(kpis.refundedOrders).toBe(1);
    expect(kpis.refundRate).toBe(50);
  });

  it('picks the most common currency when mixed', () => {
    const orders: RawOrder[] = [
      order({ processedAt: '2026-05-10T10:00:00Z', currency: 'EUR' }),
      order({ processedAt: '2026-05-10T11:00:00Z', currency: 'EUR' }),
      order({ processedAt: '2026-05-10T12:00:00Z', currency: 'USD' })
    ];
    const { kpis } = aggregate(orders);
    expect(kpis.currency).toBe('EUR');
  });
});

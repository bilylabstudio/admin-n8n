import { describe, expect, it } from 'vitest';
import { buildInsights, buildWaterfall, comparisonWindow, shiftYear, weekdayProfile } from './panel-v2';
import { resolvePanelRange } from './panel';

describe('panel v2', () => {
  it('shiftYear respeta fin de mes y bisiestos', () => {
    expect(shiftYear('2026-11-24', -1)).toBe('2025-11-24');
    expect(shiftYear('2028-02-29', -1)).toBe('2027-02-28');
  });

  it('compara con el año anterior', () => {
    const r = resolvePanelRange({ preset: 'last_month', now: new Date('2026-11-24T12:00:00Z') });
    if (!r.ok) throw new Error('rango');
    const c = comparisonWindow(r.range, 'year');
    expect(c.window).toEqual({ start: '2025-10-01', end: '2025-10-31' });
  });

  it('perfil semanal promedia por dias reales', () => {
    const rows = [
      { day: '2026-11-02', platform: 'shopify', netSales: 100, orders: 2 },
      { day: '2026-11-09', platform: 'shopify', netSales: 300, orders: 4 }
    ] as never;
    const p = weekdayProfile(rows, { start: '2026-11-02', end: '2026-11-15' });
    expect(p[0]).toMatchObject({ weekday: 'Lunes', days: 2, avgNet: 200, avgOrders: 3 });
    expect(p[6].days).toBe(2);
  });

  it('cascada cierra en el margen', () => {
    const w = buildWaterfall({ grossSales: 1000, discounts: 100, returns: 50, otherChannelsNet: 500, fees: 200, productCost: 300, ads: 0 });
    expect(w.find((s) => s.kind === 'subtotal')!.value).toBe(1350);
    expect(w.at(-1)!.value).toBe(850);
  });

  it('insights: maximo 4, sin comparacion no habla de variaciones', () => {
    const base = {
      compareLabel: 'vs mes anterior',
      netSales: 1000, previousNetSales: 500, aov: 50, previousAov: 30,
      channels: [{ platform: 'shopify', netSales: 1000, previousNetSales: 500 }],
      bestDay: { day: '2026-11-19', netSales: 300 },
      forecast: { projectedNet: 2000, previousMonthNet: 1000 },
      products: [{ product: 'Gominola', netSales: 5000, previousNetSales: 1000 }]
    };
    const all = buildInsights({ ...base, hasPrevious: true });
    expect(all.length).toBeLessThanOrEqual(4);
    expect(all[0].text).toContain('cerraría');
    const none = buildInsights({ ...base, hasPrevious: false });
    expect(none.some((i) => i.text.includes('sube'))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { computePnl, mergeRules } from './pnl';

describe('P&L', () => {
  it('reproduce el margen del Excel de la web (~18 %)', () => {
    // Excel: 298.722 uds, 5.102.724,70 €; ~115.000 pedidos (TIPSA 9,3 % ≈ 4 €/pedido). Sin videos ni agencia (no estaban en las formulas).
    const rules = mergeRules([
      { platform: 'shopify', key: 'videos', value: 1.5, active: false },
      { platform: 'shopify', key: 'ads_agency', value: 5, active: false }
    ]).filter((r) => r.platform === 'shopify');
    const p = computePnl(rules, { revenue: 5102724.7, units: 298722, orders: 118638, monthFraction: 12 });
    expect(p.estimatedMarginRate).toBeGreaterThan(17.5);
    expect(p.estimatedMarginRate).toBeLessThan(18.6);
  });

  it('la gestion de anuncios es un % del gasto en publicidad', () => {
    const rules = mergeRules([]).filter((r) => r.platform === 'amazon');
    const p = computePnl(rules, { revenue: 1000, units: 0, orders: 0, monthFraction: 1 });
    expect(p.lines.find((l) => l.key === 'amazon_ads')!.estimated).toBe(120);
    expect(p.lines.find((l) => l.key === 'ads_agency')!.estimated).toBe(6);
  });

  it('el dato real sustituye al estimado en el margen combinado', () => {
    const rules = mergeRules([]).filter((r) => r.platform === 'amazon');
    const m = { revenue: 1000, units: 10, orders: 5, monthFraction: 1 };
    const est = computePnl(rules, m);
    const real = computePnl(rules, m, { amazon_ads: 200 });
    expect(real.estimatedMargin).toBe(est.estimatedMargin);
    expect(real.blendedMargin).toBeCloseTo(est.blendedMargin - 80, 2);
    expect(real.actualLines).toBe(1);
  });

  it('gastos fijos prorrateados y lineas desactivadas', () => {
    const rules = mergeRules([{ platform: 'shopify', key: 'meta_ads', value: 49, active: false }]).filter((r) => r.platform === 'shopify');
    const p = computePnl(rules, { revenue: 0, units: 0, orders: 0, monthFraction: 0.5 });
    expect(p.lines.find((l) => l.key === 'customer_service')!.estimated).toBe(5000);
    expect(p.lines.some((l) => l.key === 'meta_ads')).toBe(false);
    expect(p.estimatedMarginRate).toBeNull();
  });
});

describe('factor de botes', () => {
  it('multiplica las unidades solo en costes por unidad', () => {
    const rules = mergeRules([]).filter((r) => r.platform === 'amazon');
    const p = computePnl(rules, { revenue: 1000, units: 10, orders: 5, monthFraction: 1 });
    expect(p.costUnits).toBe(17);
    expect(p.lines.find((l) => l.key === 'product')!.estimated).toBeCloseTo(17 * 1.46, 2);
    expect(p.lines.some((l) => l.key === 'units_factor')).toBe(false);
  });
});

describe('sumPnl', () => {
  it('suma meses y conserva el dato real solo donde existe', async () => {
    const { sumPnl } = await import('./pnl');
    const rules = mergeRules([]).filter((r) => r.platform === 'amazon');
    const a = computePnl(rules, { revenue: 1000, units: 10, orders: 5, monthFraction: 1 }, { amazon_ads: 100 });
    const b = computePnl(rules, { revenue: 2000, units: 20, orders: 10, monthFraction: 1 });
    const t = sumPnl([a, b]);
    expect(t.revenue).toBe(3000);
    expect(t.lines.find((l) => l.key === 'amazon_ads')).toMatchObject({ estimated: 360, actual: 100 });
    expect(t.blendedMargin).toBeCloseTo(a.blendedMargin + b.blendedMargin, 2);
  });
});

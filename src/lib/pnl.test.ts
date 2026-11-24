import { describe, expect, it } from 'vitest';
import { computePnl, mergeRules } from './pnl';

describe('P&L', () => {
  it('con los valores por defecto reproduce las celdas del Excel (web B18 y Amazon F18)', () => {
    const web = computePnl(mergeRules([]).filter((r) => r.platform === 'shopify'), {
      revenue: 5102724.7, units: 298722, orders: 118000, monthFraction: 12
    });
    expect(Math.abs(web.estimatedMargin - 934914.49)).toBeLessThan(5);
    expect(web.estimatedMarginRate).toBeCloseTo(18.32, 1);
    // Amazon: Excel usa 164.680 uds reales; aqui 164.680 / 1,7 articulos dan las mismas unidades de coste.
    const amz = computePnl(mergeRules([]).filter((r) => r.platform === 'amazon'), {
      revenue: 2992235.6, units: 164680 / 1.7, orders: 0, monthFraction: 1
    });
    expect(Math.abs(amz.estimatedMargin - 1554908.56)).toBeLessThan(5);
    expect(web.lines.some((l) => l.key === 'videos' || l.key === 'ads_agency')).toBe(false);
  });

  it('la gestion de anuncios es un % del gasto en publicidad', () => {
    const rules = mergeRules([{ platform: 'amazon', key: 'ads_agency', value: 5, active: true }]).filter((r) => r.platform === 'amazon');
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
    const rules = mergeRules([{ platform: 'shopify', key: 'meta_ads', value: 48.96, active: false }]).filter((r) => r.platform === 'shopify');
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

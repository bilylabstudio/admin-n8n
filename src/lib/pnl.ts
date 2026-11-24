// P&L estimado por canal a partir de supuestos (% de facturacion, € por unidad, € por pedido, fijos al mes),
// siguiendo el modelo del Excel del cliente (2026ecomerce.xlsx). Logica pura, sin base de datos.

export type PnlKind = 'pct_revenue' | 'per_unit' | 'per_order' | 'fixed_month' | 'pct_ads';
export type PnlGroup = 'ads' | 'marketing' | 'operations' | 'product' | 'fixed';

export type PnlRuleDef = {
  platform: string;
  key: string;
  label: string;
  kind: PnlKind;
  group: PnlGroup;
  value: number;
  note?: string;
};

export type PnlRule = PnlRuleDef & { active: boolean };

export const PNL_GROUP_LABELS: Record<PnlGroup, string> = {
  ads: 'Publicidad',
  marketing: 'Marketing',
  operations: 'Logística, plataforma y pagos',
  product: 'Producto',
  fixed: 'Gastos fijos'
};
export const PNL_GROUP_ORDER: PnlGroup[] = ['ads', 'marketing', 'operations', 'product', 'fixed'];

// Valores por defecto: reproducen el margen del 18 % del Excel de la web. Todos se pueden cambiar desde el panel.
export const DEFAULT_PNL_RULES: PnlRuleDef[] = [
  { platform: 'shopify', key: 'meta_ads', label: 'Meta Ads', kind: 'pct_revenue', group: 'ads', value: 49, note: 'En el Excel: 2.498.322 € sobre 5.102.725 € (49 %). El texto decía 60 %.' },
  { platform: 'shopify', key: 'google_ads', label: 'Google Ads', kind: 'pct_revenue', group: 'ads', value: 9 },
  { platform: 'shopify', key: 'ads_agency', label: 'Gestión de anuncios', kind: 'pct_ads', group: 'marketing', value: 5, note: '5 % del gasto en Meta y Google.' },
  { platform: 'shopify', key: 'videos', label: 'Producción de vídeos', kind: 'per_unit', group: 'marketing', value: 1.5 },
  { platform: 'shopify', key: 'shipping', label: 'Envíos (TIPSA)', kind: 'per_order', group: 'operations', value: 4, note: '4 € por pedido. Equivale al 9,3 % de ventas del Excel.' },
  { platform: 'shopify', key: 'shopify_fee', label: 'Plataforma Shopify', kind: 'pct_revenue', group: 'operations', value: 3 },
  { platform: 'shopify', key: 'paypal', label: 'PayPal', kind: 'pct_revenue', group: 'operations', value: 0.7 },
  { platform: 'shopify', key: 'product', label: 'Producto', kind: 'per_unit', group: 'product', value: 1.46 },
  { platform: 'shopify', key: 'customer_service', label: 'Atención al cliente', kind: 'fixed_month', group: 'fixed', value: 10000, note: '120.000 € al año.' },

  { platform: 'amazon', key: 'amazon_ads', label: 'Publicidad Amazon', kind: 'pct_revenue', group: 'ads', value: 12 },
  { platform: 'amazon', key: 'ads_agency', label: 'Gestión de anuncios', kind: 'pct_ads', group: 'marketing', value: 5, note: '5 % del gasto en publicidad de Amazon.' },
  { platform: 'amazon', key: 'videos', label: 'Producción de vídeos', kind: 'per_unit', group: 'marketing', value: 1.5 },
  { platform: 'amazon', key: 'amazon_fee', label: 'Plataforma Amazon', kind: 'pct_revenue', group: 'operations', value: 16 },
  { platform: 'amazon', key: 'amazon_logistics', label: 'Logística Amazon', kind: 'pct_revenue', group: 'operations', value: 12 },
  { platform: 'amazon', key: 'product', label: 'Producto', kind: 'per_unit', group: 'product', value: 1.46 }
];

export function mergeRules(overrides: { platform: string; key: string; value: number; active: boolean }[]): PnlRule[] {
  const byId = new Map(overrides.map((o) => [`${o.platform}:${o.key}`, o]));
  return DEFAULT_PNL_RULES.map((d) => {
    const o = byId.get(`${d.platform}:${d.key}`);
    return { ...d, value: o ? o.value : d.value, active: o ? o.active : true };
  });
}

export function ruleText(r: Pick<PnlRule, 'kind' | 'value'>): string {
  const n = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 });
  switch (r.kind) {
    case 'pct_revenue':
      return `${n(r.value)} % de la facturación`;
    case 'pct_ads':
      return `${n(r.value)} % de la publicidad`;
    case 'per_unit':
      return `${n(r.value)} € por unidad`;
    case 'per_order':
      return `${n(r.value)} € por pedido`;
    case 'fixed_month':
      return `${n(r.value)} € al mes`;
  }
}

export type PnlMetrics = {
  revenue: number;
  units: number;
  orders: number;
  /** Fraccion de mes cubierta (para gastos fijos): 1 = mes completo. */
  monthFraction: number;
};

export type PnlLine = {
  key: string;
  label: string;
  group: PnlGroup;
  rule: string;
  estimated: number;
  actual: number | null;
};

export type PnlResult = {
  revenue: number;
  units: number;
  orders: number;
  lines: PnlLine[];
  estimatedCosts: number;
  estimatedMargin: number;
  estimatedMarginRate: number | null;
  /** Costes usando el dato real donde lo hay y el estimado en el resto. */
  blendedCosts: number;
  blendedMargin: number;
  blendedMarginRate: number | null;
  actualLines: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

export function computePnl(rules: PnlRule[], m: PnlMetrics, actuals: Record<string, number> = {}): PnlResult {
  const active = rules.filter((r) => r.active);
  const base = (r: PnlRule) => {
    switch (r.kind) {
      case 'pct_revenue':
        return (m.revenue * r.value) / 100;
      case 'per_unit':
        return m.units * r.value;
      case 'per_order':
        return m.orders * r.value;
      case 'fixed_month':
        return r.value * m.monthFraction;
      case 'pct_ads':
        return 0;
    }
  };
  const estimated = new Map(active.map((r) => [r.key, base(r)]));
  const adsTotal = active.filter((r) => r.group === 'ads').reduce((a, r) => a + (estimated.get(r.key) ?? 0), 0);
  for (const r of active) if (r.kind === 'pct_ads') estimated.set(r.key, (adsTotal * r.value) / 100);

  const lines: PnlLine[] = active.map((r) => ({
    key: r.key,
    label: r.label,
    group: r.group,
    rule: ruleText(r),
    estimated: r2(estimated.get(r.key) ?? 0),
    actual: actuals[r.key] ?? null
  }));
  const estimatedCosts = lines.reduce((a, l) => a + l.estimated, 0);
  const blendedCosts = lines.reduce((a, l) => a + (l.actual ?? l.estimated), 0);
  const rate = (v: number) => (m.revenue > 0 ? r2((v / m.revenue) * 100) : null);
  return {
    revenue: r2(m.revenue),
    units: m.units,
    orders: m.orders,
    lines,
    estimatedCosts: r2(estimatedCosts),
    estimatedMargin: r2(m.revenue - estimatedCosts),
    estimatedMarginRate: rate(m.revenue - estimatedCosts),
    blendedCosts: r2(blendedCosts),
    blendedMargin: r2(m.revenue - blendedCosts),
    blendedMarginRate: rate(m.revenue - blendedCosts),
    actualLines: lines.filter((l) => l.actual !== null).length
  };
}

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Suma varios P&L (p. ej. meses de un año o canales). Las lineas se agrupan por concepto. */
export function sumPnl(results: PnlResult[]): PnlResult {
  const lines = new Map<string, PnlLine>();
  let revenue = 0;
  let units = 0;
  let orders = 0;
  for (const res of results) {
    revenue += res.revenue;
    units += res.units;
    orders += res.orders;
    for (const l of res.lines) {
      const cur = lines.get(l.key);
      if (!cur) lines.set(l.key, { ...l });
      else {
        cur.estimated = r2(cur.estimated + l.estimated);
        cur.actual = l.actual === null ? cur.actual : r2((cur.actual ?? 0) + l.actual);
      }
    }
  }
  const all = [...lines.values()];
  const estimatedCosts = all.reduce((a, l) => a + l.estimated, 0);
  const blendedCosts = results.reduce((a, x) => a + x.blendedCosts, 0);
  const rate = (v: number) => (revenue > 0 ? r2((v / revenue) * 100) : null);
  return {
    revenue: r2(revenue),
    units,
    orders,
    lines: all,
    estimatedCosts: r2(estimatedCosts),
    estimatedMargin: r2(revenue - estimatedCosts),
    estimatedMarginRate: rate(revenue - estimatedCosts),
    blendedCosts: r2(blendedCosts),
    blendedMargin: r2(revenue - blendedCosts),
    blendedMarginRate: rate(revenue - blendedCosts),
    actualLines: all.filter((l) => l.actual !== null).length
  };
}

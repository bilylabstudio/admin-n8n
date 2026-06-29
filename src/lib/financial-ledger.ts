import { buildMonthWeekPresets, dateInputFromDate, monthInputFromDate } from './sales-periods';
import { round2, toNumber } from './sales';

// Panel financiero estilo Excel, ahora POR PLATAFORMA. Cada plataforma define su propio set de
// filas (conceptos) y tasas, porque la contabilidad del cliente usa estructuras distintas:
// - Shopify: comisiones Shopify + costes producto/regalos/M&D.
// - Amazon: ingresos + ajustes, comision/logistica AMZ (fees reales), coste producto, publicidad.
// - TikTok: facturacion con IVA, FBT %, afiliados %, comision TT % (todos sobre la facturacion con IVA).
//
// Tipos de fila:
// - auto:     derivado de los pedidos (unidades, pedidos, ventas netas, facturacion con IVA).
// - computed: tasa configurable aplicada a una base (pedidos, ventas, unidades) o fee real.
// - manual:   lo introduce el usuario (FinancialLedgerEntry), por plataforma.
// - total:    sub-total de ventas, total de costes o margen.

export const LEDGER_PLATFORMS = ['shopify', 'amazon', 'tiktok_shop'] as const;
export type LedgerPlatform = (typeof LEDGER_PLATFORMS)[number];

export function isLedgerPlatform(value: string): value is LedgerPlatform {
  return (LEDGER_PLATFORMS as readonly string[]).includes(value);
}

export function resolveLedgerPlatform(value: string | null | undefined): LedgerPlatform {
  return value && isLedgerPlatform(value) ? value : 'shopify';
}

export type LedgerRowKind = 'auto' | 'computed' | 'manual' | 'total';
export type LedgerRowGroup = 'metric' | 'cost' | 'summary';
export type LedgerRowFormat = 'money' | 'integer';

// Metricas automaticas disponibles por sub-periodo.
type AutoMetric = 'units' | 'orders' | 'net_sales' | 'gross_sales';

// Bases de calculo de las filas 'computed'.
type ComputeSpec =
  | { base: 'orders'; rateKey: string } // nº pedidos * tasa
  | { base: 'net_pct'; rateKey: string } // ventas netas * tasa%
  | { base: 'gross_pct'; rateKey: string } // facturacion con IVA * tasa%
  | { base: 'units'; rateKey: string } // unidades * tasa
  | { base: 'fee'; feeTypes: string[] }; // suma fees reales por tipo de transaccion

type TotalKind = 'revenue_subtotal' | 'total_costs' | 'margin';

export type LedgerRowConfig = {
  key: string;
  label: string;
  kind: LedgerRowKind;
  group: LedgerRowGroup;
  format: LedgerRowFormat;
  auto?: AutoMetric;
  compute?: ComputeSpec;
  total?: TotalKind;
  revenue?: boolean; // cuenta para la base de ventas del margen
};

export type LedgerRateConfig = { key: string; label: string; suffix: string; default: number };

export type LedgerPlatformConfig = {
  rows: LedgerRowConfig[];
  rates: LedgerRateConfig[];
  // Si el subtotal ya lleva el IVA dentro (Shopify/TikTok con precios IVA-incluido) restamos
  // total_tax para la venta neta. En Amazon el item-price del informe es SIN IVA (el IVA va
  // aparte), asi que no se resta y la facturacion con IVA se obtiene sumandolo.
  taxInSubtotal: boolean;
};

// ----------------------------- Config por plataforma -----------------------------

const SHOPIFY_CONFIG: LedgerPlatformConfig = {
  rows: [
    { key: 'units', label: 'Unidades', kind: 'auto', group: 'metric', format: 'integer', auto: 'units' },
    { key: 'sales', label: 'TOTAL VENTAS + envíos', kind: 'auto', group: 'metric', format: 'money', auto: 'net_sales', revenue: true },
    { key: 'orders', label: 'Número de pedidos', kind: 'auto', group: 'metric', format: 'integer', auto: 'orders' },
    { key: 'replo', label: 'Replo', kind: 'manual', group: 'cost', format: 'money' },
    { key: 'paypal_sync', label: 'Paypal sincronizador', kind: 'manual', group: 'cost', format: 'money' },
    { key: 'omega_pixel', label: 'Omega Facebook Pixel', kind: 'manual', group: 'cost', format: 'money' },
    { key: 'shopify_app', label: 'Shopify', kind: 'manual', group: 'cost', format: 'money' },
    { key: 'tipsa', label: 'TIPSA - 4', kind: 'manual', group: 'cost', format: 'money' },
    { key: 'commission_order', label: 'Comisión Shopify por pedido', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'orders', rateKey: 'commission_per_order' } },
    { key: 'commission_sales', label: 'Comisión Shopify por venta', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'net_pct', rateKey: 'commission_pct' } },
    { key: 'ads_meta', label: 'ADS - Meta', kind: 'manual', group: 'cost', format: 'money' },
    { key: 'product_cost', label: 'Coste p° x3.2', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'units', rateKey: 'product_cost_unit' } },
    { key: 'gift_cost', label: 'Coste p° REGALOS 0.8', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'units', rateKey: 'gift_cost_unit' } },
    { key: 'md_cost', label: 'Coste M&D x1.5', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'units', rateKey: 'md_cost_unit' } },
    { key: 'total_costs', label: 'TOTAL COSTES', kind: 'total', group: 'summary', format: 'money', total: 'total_costs' },
    { key: 'margin', label: 'Margen', kind: 'total', group: 'summary', format: 'money', total: 'margin' }
  ],
  rates: [
    { key: 'commission_per_order', label: 'Comisión por pedido', suffix: '€/pedido', default: 0.3 },
    { key: 'commission_pct', label: 'Comisión por venta', suffix: '% ventas', default: 1.6 },
    { key: 'product_cost_unit', label: 'Coste producto/ud', suffix: '€/ud', default: 3.2 },
    { key: 'gift_cost_unit', label: 'Coste regalos/ud', suffix: '€/ud', default: 0.8 },
    { key: 'md_cost_unit', label: 'Coste M&D/ud', suffix: '€/ud', default: 1.5 }
  ],
  taxInSubtotal: true
};

const AMAZON_CONFIG: LedgerPlatformConfig = {
  rows: [
    { key: 'ingresos', label: 'Ingresos netos', kind: 'auto', group: 'metric', format: 'money', auto: 'net_sales', revenue: true },
    { key: 'ajustes', label: 'Ajustes', kind: 'manual', group: 'metric', format: 'money', revenue: true },
    { key: 'total_ventas', label: 'TOTAL VENTAS', kind: 'total', group: 'metric', format: 'money', total: 'revenue_subtotal' },
    { key: 'units', label: 'Unidades', kind: 'auto', group: 'metric', format: 'integer', auto: 'units' },
    { key: 'commission_amz', label: 'Comisión AMZ', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'fee', feeTypes: ['commission', 'referral', 'comision'] } },
    { key: 'logistica_amz', label: 'Logística AMZ', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'fee', feeTypes: ['fba', 'fulfillment', 'logist', 'shipping'] } },
    { key: 'product_cost', label: 'Coste producto', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'units', rateKey: 'product_cost_unit' } },
    { key: 'publicidad', label: 'Publicidad', kind: 'manual', group: 'cost', format: 'money' },
    { key: 'otros_costes', label: 'Otros costes', kind: 'manual', group: 'cost', format: 'money' },
    { key: 'total_costs', label: 'TOTAL COSTES', kind: 'total', group: 'summary', format: 'money', total: 'total_costs' },
    { key: 'margin', label: 'Margen', kind: 'total', group: 'summary', format: 'money', total: 'margin' }
  ],
  rates: [
    { key: 'product_cost_unit', label: 'Coste producto/ud', suffix: '€/ud', default: 4.7 }
  ],
  taxInSubtotal: false
};

const TIKTOK_CONFIG: LedgerPlatformConfig = {
  rows: [
    { key: 'facturacion', label: 'Facturación + envíos (con IVA)', kind: 'auto', group: 'metric', format: 'money', auto: 'gross_sales' },
    { key: 'sales', label: 'Total ventas + envíos (sin IVA)', kind: 'auto', group: 'metric', format: 'money', auto: 'net_sales', revenue: true },
    { key: 'units', label: 'Unidades', kind: 'auto', group: 'metric', format: 'integer', auto: 'units' },
    { key: 'orders', label: 'Número de pedidos', kind: 'auto', group: 'metric', format: 'integer', auto: 'orders' },
    { key: 'fbt', label: 'FBT 7,5%', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'gross_pct', rateKey: 'fbt_pct' } },
    { key: 'product_cost', label: 'Coste p° x3.2', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'units', rateKey: 'product_cost_unit' } },
    { key: 'md_cost', label: 'Coste M&D x1.5', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'units', rateKey: 'md_cost_unit' } },
    { key: 'affiliates', label: 'Coste afiliados 15%', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'gross_pct', rateKey: 'affiliate_pct' } },
    { key: 'ads', label: 'Gasto ADS', kind: 'manual', group: 'cost', format: 'money' },
    { key: 'commission_tt', label: 'Comisión TT 9%', kind: 'computed', group: 'cost', format: 'money', compute: { base: 'gross_pct', rateKey: 'commission_pct' } },
    { key: 'total_costs', label: 'TOTAL COSTES', kind: 'total', group: 'summary', format: 'money', total: 'total_costs' },
    { key: 'margin', label: 'Margen', kind: 'total', group: 'summary', format: 'money', total: 'margin' }
  ],
  rates: [
    { key: 'fbt_pct', label: 'FBT', suffix: '% facturación', default: 7.5 },
    { key: 'product_cost_unit', label: 'Coste producto/ud', suffix: '€/ud', default: 3.2 },
    { key: 'md_cost_unit', label: 'Coste M&D/ud', suffix: '€/ud', default: 1.5 },
    { key: 'affiliate_pct', label: 'Afiliados', suffix: '% facturación', default: 15 },
    { key: 'commission_pct', label: 'Comisión TT', suffix: '% facturación', default: 9 }
  ],
  taxInSubtotal: true
};

export const LEDGER_CONFIG: Record<LedgerPlatform, LedgerPlatformConfig> = {
  shopify: SHOPIFY_CONFIG,
  amazon: AMAZON_CONFIG,
  tiktok_shop: TIKTOK_CONFIG
};

export function getLedgerConfig(platform: string): LedgerPlatformConfig {
  return LEDGER_CONFIG[resolveLedgerPlatform(platform)];
}

export function manualLineKeys(platform: string): string[] {
  return getLedgerConfig(platform).rows.filter((row) => row.kind === 'manual').map((row) => row.key);
}

export function rateFields(platform: string): { key: string; label: string; suffix: string }[] {
  return getLedgerConfig(platform).rates.map(({ key, label, suffix }) => ({ key, label, suffix }));
}

export function rateKeys(platform: string): string[] {
  return getLedgerConfig(platform).rates.map((rate) => rate.key);
}

export function rateDefaults(platform: string): Record<string, number> {
  return Object.fromEntries(getLedgerConfig(platform).rates.map((rate) => [rate.key, rate.default]));
}

export function resolveRates(platform: string, settings: { key: string; value: unknown }[]): Record<string, number> {
  const result = rateDefaults(platform);
  for (const setting of settings) {
    if (setting.key in result) result[setting.key] = toNumber(setting.value);
  }
  return result;
}

// ----------------------------- Tipos de entrada -----------------------------

export type LedgerOrderInput = {
  processedAt: Date;
  totalUnits: number;
  subtotal: unknown;
  totalShipping: unknown;
  totalTax: unknown;
  totalRefunded: unknown;
};

export type LedgerFeeInput = {
  postedAt: Date;
  transactionType: string | null;
  amount: unknown;
};

export type LedgerEntryInput = {
  periodLabel: string;
  lineKey: string;
  amount: unknown;
};

export type LedgerPeriod = { label: string; startDate: string; endDate: string };

export type LedgerRowResult = {
  key: string;
  label: string;
  kind: LedgerRowKind;
  group: LedgerRowGroup;
  format: LedgerRowFormat;
  cells: number[];
  total: number;
};

export type LedgerMatrix = {
  platform: LedgerPlatform;
  month: string;
  periods: LedgerPeriod[];
  rows: LedgerRowResult[];
  rates: Record<string, number>;
  rateFields: { key: string; label: string; suffix: string }[];
};

export function normalizeMonthInput(value: string | null | undefined): string {
  if (value && /^\d{4}-\d{2}$/.test(value)) return value;
  return monthInputFromDate(new Date());
}

// Rango UTC con 1 dia de margen por lado para capturar pedidos en el borde del mes
// (la asignacion exacta al sub-periodo se hace luego por dia en zona horaria de la tienda).
export function monthQueryRange(month: string): { since: Date; until: Date } {
  const [year, m] = month.split('-').map(Number);
  const since = new Date(Date.UTC(year, m - 1, 1));
  since.setUTCDate(since.getUTCDate() - 1);
  since.setUTCHours(0, 0, 0, 0);
  const until = new Date(Date.UTC(year, m, 0));
  until.setUTCDate(until.getUTCDate() + 1);
  until.setUTCHours(23, 59, 59, 999);
  return { since, until };
}

function matchesFeeType(transactionType: string | null, feeTypes: string[]): boolean {
  const normalized = String(transactionType || '').toLowerCase();
  return feeTypes.some((type) => normalized.includes(type));
}

export function buildLedgerMatrix(input: {
  platform: string;
  month: string;
  orders: LedgerOrderInput[];
  fees?: LedgerFeeInput[];
  rates: Record<string, number>;
  entries: LedgerEntryInput[];
}): LedgerMatrix {
  const platform = resolveLedgerPlatform(input.platform);
  const config = LEDGER_CONFIG[platform];
  const periods = buildMonthWeekPresets(input.month);
  const base = periods.map(() => ({ units: 0, orders: 0, net: 0, gross: 0 }));
  const feeBase: { type: string | null; amount: number }[][] = periods.map(() => []);

  function periodIndexFor(date: Date): number {
    const day = dateInputFromDate(date);
    return periods.findIndex((period) => day >= period.startDate && day <= period.endDate);
  }

  for (const order of input.orders) {
    const index = periodIndexFor(order.processedAt);
    if (index < 0) continue;
    const bucket = base[index];
    bucket.units += order.totalUnits;
    bucket.orders += 1;
    const subtotalShipping = toNumber(order.subtotal) + toNumber(order.totalShipping);
    const tax = toNumber(order.totalTax);
    const refund = toNumber(order.totalRefunded);
    if (config.taxInSubtotal) {
      // Shopify/TikTok: el subtotal ya incluye IVA.
      bucket.gross += subtotalShipping;
      bucket.net += subtotalShipping - tax - refund;
    } else {
      // Amazon: el subtotal es sin IVA; la facturacion con IVA lo suma.
      bucket.gross += subtotalShipping + tax;
      bucket.net += subtotalShipping - refund;
    }
  }

  for (const fee of input.fees ?? []) {
    const index = periodIndexFor(fee.postedAt);
    if (index < 0) continue;
    feeBase[index].push({ type: fee.transactionType, amount: toNumber(fee.amount) });
  }

  const manual = new Map<string, number>();
  for (const entry of input.entries) {
    manual.set(`${entry.periodLabel}::${entry.lineKey}`, toNumber(entry.amount));
  }

  const rates = input.rates;
  const rowByKey = new Map(config.rows.map((row) => [row.key, row] as const));
  const revenueKeys = config.rows.filter((row) => row.revenue).map((row) => row.key);
  const costKeys = config.rows.filter((row) => row.group === 'cost').map((row) => row.key);

  function autoValue(metric: AutoMetric, index: number): number {
    if (metric === 'units') return base[index].units;
    if (metric === 'orders') return base[index].orders;
    if (metric === 'net_sales') return base[index].net;
    return base[index].gross;
  }

  function computeValue(spec: ComputeSpec, index: number): number {
    if (spec.base === 'orders') return base[index].orders * (rates[spec.rateKey] ?? 0);
    if (spec.base === 'net_pct') return base[index].net * ((rates[spec.rateKey] ?? 0) / 100);
    if (spec.base === 'gross_pct') return base[index].gross * ((rates[spec.rateKey] ?? 0) / 100);
    if (spec.base === 'units') return base[index].units * (rates[spec.rateKey] ?? 0);
    // fee: suma (en positivo) los fees cuyo tipo coincide.
    return feeBase[index]
      .filter((fee) => matchesFeeType(fee.type, spec.feeTypes))
      .reduce((sum, fee) => sum + Math.abs(fee.amount), 0);
  }

  function cellValue(key: string, index: number): number {
    const row = rowByKey.get(key);
    if (!row) return 0;
    if (row.kind === 'auto' && row.auto) return autoValue(row.auto, index);
    if (row.kind === 'computed' && row.compute) return computeValue(row.compute, index);
    if (row.kind === 'manual') return manual.get(`${periods[index].label}::${key}`) ?? 0;
    if (row.total === 'revenue_subtotal') return revenueKeys.reduce((acc, k) => acc + cellValue(k, index), 0);
    if (row.total === 'total_costs') return costKeys.reduce((acc, k) => acc + cellValue(k, index), 0);
    if (row.total === 'margin') {
      const revenue = revenueKeys.reduce((acc, k) => acc + cellValue(k, index), 0);
      const costs = costKeys.reduce((acc, k) => acc + cellValue(k, index), 0);
      return revenue - costs;
    }
    return 0;
  }

  const rows: LedgerRowResult[] = config.rows.map((row) => {
    const cells = periods.map((_, index) => round2(cellValue(row.key, index)));
    const total = round2(cells.reduce((acc, value) => acc + value, 0));
    return {
      key: row.key,
      label: row.label,
      kind: row.kind,
      group: row.group,
      format: row.format,
      cells,
      total
    };
  });

  return { platform, month: input.month, periods, rows, rates, rateFields: rateFields(platform) };
}

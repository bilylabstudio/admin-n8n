import { buildMonthWeekPresets, dateInputFromDate, monthInputFromDate } from './sales-periods';
import { round2, toNumber } from './sales';

// Panel financiero estilo Excel: filas (conceptos) x sub-periodos del mes + columna TOTAL.
// - auto: derivado directamente de los pedidos (PlatformOrder).
// - computed: tasa configurable x metrica de pedidos.
// - manual: lo introduce el usuario y se guarda en FinancialLedgerEntry.
// - total: suma/formula a partir de las demas filas.

export type LedgerRowKind = 'auto' | 'computed' | 'manual' | 'total';
export type LedgerRowGroup = 'metric' | 'cost' | 'summary';
export type LedgerRowFormat = 'money' | 'integer';

export type LedgerRowConfig = {
  key: string;
  label: string;
  kind: LedgerRowKind;
  group: LedgerRowGroup;
  format: LedgerRowFormat;
};

export const LEDGER_ROWS: LedgerRowConfig[] = [
  { key: 'units', label: 'Unidades', kind: 'auto', group: 'metric', format: 'integer' },
  { key: 'sales', label: 'TOTAL VENTAS + envíos', kind: 'auto', group: 'metric', format: 'money' },
  { key: 'orders', label: 'Número de pedidos', kind: 'auto', group: 'metric', format: 'integer' },
  { key: 'replo', label: 'Replo', kind: 'manual', group: 'cost', format: 'money' },
  { key: 'paypal_sync', label: 'Paypal sincronizador', kind: 'manual', group: 'cost', format: 'money' },
  { key: 'omega_pixel', label: 'Omega Facebook Pixel', kind: 'manual', group: 'cost', format: 'money' },
  { key: 'shopify_app', label: 'Shopify', kind: 'manual', group: 'cost', format: 'money' },
  { key: 'tipsa', label: 'TIPSA - 4', kind: 'manual', group: 'cost', format: 'money' },
  { key: 'commission_order', label: 'Comisión Shopify por pedido', kind: 'computed', group: 'cost', format: 'money' },
  { key: 'commission_sales', label: 'Comisión Shopify por venta', kind: 'computed', group: 'cost', format: 'money' },
  { key: 'ads_meta', label: 'ADS - Meta', kind: 'manual', group: 'cost', format: 'money' },
  { key: 'product_cost', label: 'Coste p° x3.2', kind: 'computed', group: 'cost', format: 'money' },
  { key: 'gift_cost', label: 'Coste p° REGALOS 0.8', kind: 'computed', group: 'cost', format: 'money' },
  { key: 'md_cost', label: 'Coste M&D x1.5', kind: 'computed', group: 'cost', format: 'money' },
  { key: 'total_costs', label: 'TOTAL COSTES', kind: 'total', group: 'summary', format: 'money' },
  { key: 'margin', label: 'Margen', kind: 'total', group: 'summary', format: 'money' }
];

export const MANUAL_LINE_KEYS = LEDGER_ROWS.filter((row) => row.kind === 'manual').map((row) => row.key);
const COST_KEYS = LEDGER_ROWS.filter((row) => row.group === 'cost').map((row) => row.key);

export type LedgerRateKey =
  | 'commission_per_order'
  | 'commission_pct'
  | 'product_cost_unit'
  | 'gift_cost_unit'
  | 'md_cost_unit';

export const LEDGER_RATE_DEFAULTS: Record<LedgerRateKey, number> = {
  commission_per_order: 0.3,
  commission_pct: 1.6,
  product_cost_unit: 3.2,
  gift_cost_unit: 0.8,
  md_cost_unit: 1.5
};

export const LEDGER_RATE_CONFIG: { key: LedgerRateKey; label: string; suffix: string }[] = [
  { key: 'commission_per_order', label: 'Comisión Shopify por pedido', suffix: '€ / pedido' },
  { key: 'commission_pct', label: 'Comisión Shopify por venta', suffix: '% de ventas' },
  { key: 'product_cost_unit', label: 'Coste producto por unidad', suffix: '€ / unidad' },
  { key: 'gift_cost_unit', label: 'Coste regalos por unidad', suffix: '€ / unidad' },
  { key: 'md_cost_unit', label: 'Coste M&D por unidad', suffix: '€ / unidad' }
];

export const LEDGER_RATE_KEYS = LEDGER_RATE_CONFIG.map((rate) => rate.key);

export type LedgerOrderInput = {
  processedAt: Date;
  totalUnits: number;
  subtotal: unknown;
  totalShipping: unknown;
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
  month: string;
  periods: LedgerPeriod[];
  rows: LedgerRowResult[];
  rates: Record<LedgerRateKey, number>;
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

export function resolveRates(settings: { key: string; value: unknown }[]): Record<LedgerRateKey, number> {
  const result = { ...LEDGER_RATE_DEFAULTS };
  for (const setting of settings) {
    if (setting.key in result) {
      result[setting.key as LedgerRateKey] = toNumber(setting.value);
    }
  }
  return result;
}

export function buildLedgerMatrix(input: {
  month: string;
  orders: LedgerOrderInput[];
  rates: Record<LedgerRateKey, number>;
  entries: LedgerEntryInput[];
}): LedgerMatrix {
  const periods = buildMonthWeekPresets(input.month);
  const base = periods.map(() => ({ units: 0, orders: 0, sales: 0 }));

  for (const order of input.orders) {
    const day = dateInputFromDate(order.processedAt);
    const periodIndex = periods.findIndex((period) => day >= period.startDate && day <= period.endDate);
    if (periodIndex < 0) continue;
    const bucket = base[periodIndex];
    bucket.units += order.totalUnits;
    bucket.orders += 1;
    bucket.sales += toNumber(order.subtotal) + toNumber(order.totalShipping);
  }

  const manual = new Map<string, number>();
  for (const entry of input.entries) {
    manual.set(`${entry.periodLabel}::${entry.lineKey}`, toNumber(entry.amount));
  }

  const rates = input.rates;

  const autoOrComputed: Record<string, (index: number) => number> = {
    units: (i) => base[i].units,
    sales: (i) => base[i].sales,
    orders: (i) => base[i].orders,
    commission_order: (i) => base[i].orders * rates.commission_per_order,
    commission_sales: (i) => base[i].sales * (rates.commission_pct / 100),
    product_cost: (i) => base[i].units * rates.product_cost_unit,
    gift_cost: (i) => base[i].units * rates.gift_cost_unit,
    md_cost: (i) => base[i].units * rates.md_cost_unit
  };

  const rowByKey = new Map(LEDGER_ROWS.map((row) => [row.key, row] as const));

  function cellValue(key: string, index: number): number {
    const row = rowByKey.get(key);
    if (!row) return 0;
    if (row.kind === 'auto' || row.kind === 'computed') return autoOrComputed[key](index);
    if (row.kind === 'manual') return manual.get(`${periods[index].label}::${key}`) ?? 0;
    if (key === 'total_costs') return COST_KEYS.reduce((acc, costKey) => acc + cellValue(costKey, index), 0);
    if (key === 'margin') return cellValue('sales', index) - cellValue('total_costs', index);
    return 0;
  }

  const rows: LedgerRowResult[] = LEDGER_ROWS.map((row) => {
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

  return { month: input.month, periods, rows, rates };
}

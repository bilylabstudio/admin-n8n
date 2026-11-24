// Panel de negocio (/panel): logica pura de periodos, agregados y alertas.
// Solo lee de las tablas existentes; no comparte estado con /ventas.

import { resolveRates } from './financial-ledger';

export const PANEL_PLATFORMS = ['shopify', 'amazon', 'tiktok_shop'] as const;
export type PanelPlatform = (typeof PANEL_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<string, string> = {
  shopify: 'Shopify',
  amazon: 'Amazon',
  tiktok_shop: 'TikTok Shop'
};

// Ventas contables: igual que el panel financiero (cuadrado contra el Excel del cliente).
export const SALE_STATUSES = ['paid', 'partially_paid'];

export const PANEL_TIME_ZONE = 'Europe/Madrid';

// ----------------------------- Periodos -----------------------------

export type PanelPreset = 'mtd' | 'last_month' | '30d' | '90d' | 'ytd' | 'custom';

export const PANEL_PRESETS: { id: Exclude<PanelPreset, 'custom'>; label: string }[] = [
  { id: 'mtd', label: 'Este mes' },
  { id: 'last_month', label: 'Mes pasado' },
  { id: '30d', label: '30 días' },
  { id: '90d', label: '90 días' },
  { id: 'ytd', label: 'Este año' }
];

export type DateWindow = { start: string; end: string }; // YYYY-MM-DD inclusive, hora de Madrid

export type PanelRange = {
  preset: PanelPreset;
  current: DateWindow;
  previous: DateWindow;
  compareLabel: string;
  today: string;
};

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function addDays(day: string, days: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

export function daysBetweenInclusive(start: string, end: string): number {
  return Math.round((parseDay(end).getTime() - parseDay(start).getTime()) / 86_400_000) + 1;
}

export function daysInMonth(day: string): number {
  const d = parseDay(day);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Fecha de hoy en horario de Madrid (YYYY-MM-DD). */
export function todayInMadrid(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PANEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
  return parts;
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function shiftMonth(day: string, months: number): string {
  const d = parseDay(day);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1));
  const maxDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), maxDay));
  return isoDay(target);
}

function monthEnd(day: string): string {
  return `${day.slice(0, 7)}-${String(daysInMonth(day)).padStart(2, '0')}`;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function resolvePanelRange(input: {
  preset?: string | null;
  start?: string | null;
  end?: string | null;
  now?: Date;
}): { ok: true; range: PanelRange } | { ok: false; error: string } {
  const today = todayInMadrid(input.now);
  const start = input.start?.trim();
  const end = input.end?.trim();

  if (start || end) {
    if (!start || !end || !DAY_RE.test(start) || !DAY_RE.test(end)) {
      return { ok: false, error: 'Fechas invalidas. Usa YYYY-MM-DD en inicio y fin.' };
    }
    if (start > end) return { ok: false, error: 'La fecha inicio no puede ser posterior a la final.' };
    const length = daysBetweenInclusive(start, end);
    const prevEnd = addDays(start, -1);
    return {
      ok: true,
      range: {
        preset: 'custom',
        current: { start, end },
        previous: { start: addDays(prevEnd, -(length - 1)), end: prevEnd },
        compareLabel: `vs ${length} días anteriores`,
        today
      }
    };
  }

  const preset = (PANEL_PRESETS.some((p) => p.id === input.preset) ? input.preset : 'mtd') as Exclude<
    PanelPreset,
    'custom'
  >;

  if (preset === 'mtd') {
    const current = { start: monthStart(today), end: today };
    const prevStart = shiftMonth(current.start, -1);
    // Mismo numero de dias del mes anterior (1-20 nov vs 1-20 oct), recortado al fin de mes.
    const prevEndCandidate = shiftMonth(today, -1);
    return {
      ok: true,
      range: {
        preset,
        current,
        previous: { start: prevStart, end: prevEndCandidate },
        compareLabel: 'vs mismo tramo del mes anterior',
        today
      }
    };
  }

  if (preset === 'last_month') {
    const lastMonthDay = shiftMonth(monthStart(today), -1);
    const current = { start: lastMonthDay, end: monthEnd(lastMonthDay) };
    const prev = shiftMonth(lastMonthDay, -1);
    return {
      ok: true,
      range: {
        preset,
        current,
        previous: { start: prev, end: monthEnd(prev) },
        compareLabel: 'vs el mes anterior',
        today
      }
    };
  }

  if (preset === 'ytd') {
    const current = { start: `${today.slice(0, 4)}-01-01`, end: today };
    const prevYear = String(Number(today.slice(0, 4)) - 1);
    return {
      ok: true,
      range: {
        preset,
        current,
        previous: { start: `${prevYear}-01-01`, end: `${prevYear}${today.slice(4)}` },
        compareLabel: 'vs mismo periodo del año anterior',
        today
      }
    };
  }

  const length = preset === '30d' ? 30 : 90;
  const current = { start: addDays(today, -(length - 1)), end: today };
  const prevEnd = addDays(current.start, -1);
  return {
    ok: true,
    range: {
      preset,
      current,
      previous: { start: addDays(prevEnd, -(length - 1)), end: prevEnd },
      compareLabel: `vs ${length} días anteriores`,
      today
    }
  };
}

// ----------------------------- Agregados -----------------------------

/** Una fila por (dia de Madrid, plataforma), ya agregada en SQL. */
export type DailyPlatformRow = {
  day: string;
  platform: string;
  orders: number; // pedidos de venta (paid / partially_paid)
  units: number;
  grossSales: number; // con IVA
  netSales: number; // sin IVA y menos devoluciones
  refunded: number;
  refundedOrders: number; // pedidos con devolucion (cualquier estado)
  allOrders: number; // todos los pedidos no cancelados ni test
  pendingOrders: number;
  zeroAmountOrders: number; // pedidos (venta o pendientes) con total 0
  // Desglose al estilo del informe de Shopify (sin IVA). Solo se rellena en Shopify.
  productGross?: number; // ventas brutas de producto
  discounts?: number;
  returns?: number; // devoluciones contadas en la fecha del reembolso
  taxes?: number; // impuestos de las ventas menos los devueltos
  shipping?: number; // envios cobrados (con IVA), fuera de las ventas netas
};

export type MoneyAdjustments = {
  feesByPlatform: Record<string, number>;
  adsByPlatform: Record<string, number>;
};

export type RateSettingRow = { platform: string; key: string; value: unknown };

export type PlatformTotals = {
  orders: number;
  units: number;
  grossSales: number;
  netSales: number;
  refunded: number;
  refundedOrders: number;
  allOrders: number;
  pendingOrders: number;
  zeroAmountOrders: number;
  productGross: number;
  discounts: number;
  returns: number;
  taxes: number;
  shipping: number;
};

const EMPTY_TOTALS: PlatformTotals = {
  orders: 0,
  units: 0,
  grossSales: 0,
  netSales: 0,
  refunded: 0,
  refundedOrders: 0,
  allOrders: 0,
  pendingOrders: 0,
  zeroAmountOrders: 0,
  productGross: 0,
  discounts: 0,
  returns: 0,
  taxes: 0,
  shipping: 0
};

export function sumRows(rows: DailyPlatformRow[]): PlatformTotals {
  const t = { ...EMPTY_TOTALS };
  for (const r of rows) {
    t.orders += r.orders;
    t.units += r.units;
    t.grossSales += r.grossSales;
    t.netSales += r.netSales;
    t.refunded += r.refunded;
    t.refundedOrders += r.refundedOrders;
    t.allOrders += r.allOrders;
    t.pendingOrders += r.pendingOrders;
    t.zeroAmountOrders += r.zeroAmountOrders;
    t.productGross += r.productGross ?? 0;
    t.discounts += r.discounts ?? 0;
    t.returns += r.returns ?? 0;
    t.taxes += r.taxes ?? 0;
    t.shipping += r.shipping ?? 0;
  }
  return t;
}

export function inWindow(day: string, w: DateWindow): boolean {
  return day >= w.start && day <= w.end;
}

export type ContributionBreakdown = {
  netSales: number;
  fees: number;
  feesSource: 'api' | 'estimated' | 'missing';
  productCost: number;
  ads: number;
  adsSource: 'api' | 'missing';
  contribution: number;
  contributionRate: number | null;
};

/**
 * Margen de contribucion = ventas netas - comisiones - coste de producto - publicidad.
 * Usa datos reales de API si existen; si no, las tasas configuradas en el panel financiero
 * (FinancialSetting o los valores por defecto). Cada componente indica su origen.
 */
export function contributionFor(
  platform: string,
  totals: PlatformTotals,
  adjustments: MoneyAdjustments,
  settings: RateSettingRow[]
): ContributionBreakdown {
  const rates = resolveRates(
    platform,
    settings.filter((s) => s.platform === platform).map(({ key, value }) => ({ key, value }))
  );
  const apiFees = adjustments.feesByPlatform[platform] ?? 0;
  const ads = adjustments.adsByPlatform[platform] ?? 0;

  let fees = 0;
  let feesSource: ContributionBreakdown['feesSource'] = 'missing';
  if (apiFees > 0) {
    fees = apiFees;
    feesSource = 'api';
  } else if (platform === 'shopify') {
    fees = totals.orders * (rates.commission_per_order ?? 0) + (totals.netSales * (rates.commission_pct ?? 0)) / 100;
    feesSource = 'estimated';
  } else if (platform === 'tiktok_shop') {
    const pct = (rates.commission_pct ?? 0) + (rates.fbt_pct ?? 0) + (rates.affiliate_pct ?? 0);
    fees = (totals.grossSales * pct) / 100;
    feesSource = 'estimated';
  }

  const perUnit =
    (rates.product_cost_unit ?? 0) + (rates.gift_cost_unit ?? 0) + (rates.md_cost_unit ?? 0);
  const productCost = totals.units * perUnit;
  const contribution = totals.netSales - fees - productCost - ads;

  return {
    netSales: round2(totals.netSales),
    fees: round2(fees),
    feesSource,
    productCost: round2(productCost),
    ads: round2(ads),
    adsSource: ads > 0 ? 'api' : 'missing',
    contribution: round2(contribution),
    contributionRate: totals.netSales > 0 ? round2((contribution / totals.netSales) * 100) : null
  };
}

export type Kpis = {
  netSales: number;
  grossSales: number;
  orders: number;
  units: number;
  aov: number;
  refundRate: number;
  contribution: number;
  contributionRate: number | null;
};

export function kpisFrom(totals: PlatformTotals, contribution: number): Kpis {
  const refundBase = totals.orders + totals.refundedOrders;
  return {
    netSales: round2(totals.netSales),
    grossSales: round2(totals.grossSales),
    orders: totals.orders,
    units: totals.units,
    aov: totals.orders ? round2(totals.netSales / totals.orders) : 0,
    refundRate: refundBase ? round2((totals.refundedOrders / refundBase) * 100) : 0,
    contribution: round2(contribution),
    contributionRate: totals.netSales > 0 ? round2((contribution / totals.netSales) * 100) : null
  };
}

export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

// ----------------------------- Prevision -----------------------------

export type MonthForecast = {
  month: string;
  daysElapsed: number;
  daysInMonth: number;
  netToDate: number;
  projectedNet: number;
  projectedByLast7: number;
  previousMonthNet: number;
  vsPreviousMonth: number | null;
};

/**
 * Prevision de cierre de mes a ritmo actual. Usa los dias completos (hasta ayer) para no
 * penalizar el dia en curso. Devuelve tambien la proyeccion al ritmo de los ultimos 7 dias.
 */
export function forecastMonth(
  daily: { day: string; netSales: number }[],
  today: string,
  previousMonthNet: number
): MonthForecast | null {
  const start = monthStart(today);
  const yesterday = addDays(today, -1);
  if (yesterday < start) return null;
  const total = daysInMonth(today);
  const elapsed = daysBetweenInclusive(start, yesterday);
  const netComplete = daily.filter((d) => d.day >= start && d.day <= yesterday).reduce((a, d) => a + d.netSales, 0);
  const netToDate = daily.filter((d) => d.day >= start && d.day <= today).reduce((a, d) => a + d.netSales, 0);
  const last7Start = addDays(yesterday, -6);
  const last7 = daily.filter((d) => d.day >= last7Start && d.day <= yesterday).reduce((a, d) => a + d.netSales, 0);
  const remaining = total - elapsed;
  const projectedNet = (netComplete / elapsed) * total;
  const projectedByLast7 = netComplete + (last7 / 7) * remaining;
  return {
    month: today.slice(0, 7),
    daysElapsed: elapsed,
    daysInMonth: total,
    netToDate: round2(netToDate),
    projectedNet: round2(projectedNet),
    projectedByLast7: round2(projectedByLast7),
    previousMonthNet: round2(previousMonthNet),
    vsPreviousMonth: pctChange(projectedNet, previousMonthNet)
  };
}

// ----------------------------- Series -----------------------------

export type SeriesPoint = { key: string; values: Record<string, number>; orders: Record<string, number> };

export function seriesGranularity(window: DateWindow): 'day' | 'week' | 'month' {
  const length = daysBetweenInclusive(window.start, window.end);
  if (length <= 62) return 'day';
  if (length <= 190) return 'week';
  return 'month';
}

/** Lunes de la semana ISO del dia. */
export function weekStart(day: string): string {
  const d = parseDay(day);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return isoDay(d);
}

export function bucketFor(day: string, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'day') return day;
  if (granularity === 'week') return weekStart(day);
  return day.slice(0, 7);
}

export function buildSeries(
  rows: DailyPlatformRow[],
  window: DateWindow,
  granularity: 'day' | 'week' | 'month'
): SeriesPoint[] {
  const keys: string[] = [];
  let cursor = window.start;
  while (cursor <= window.end) {
    const key = bucketFor(cursor, granularity);
    if (keys[keys.length - 1] !== key) keys.push(key);
    cursor = addDays(cursor, 1);
  }
  const map = new Map<string, SeriesPoint>(keys.map((key) => [key, { key, values: {}, orders: {} }]));
  for (const row of rows) {
    if (!inWindow(row.day, window)) continue;
    const point = map.get(bucketFor(row.day, granularity));
    if (!point) continue;
    point.values[row.platform] = (point.values[row.platform] ?? 0) + row.netSales;
    point.orders[row.platform] = (point.orders[row.platform] ?? 0) + row.orders;
  }
  return keys.map((key) => {
    const p = map.get(key)!;
    for (const k of Object.keys(p.values)) p.values[k] = round2(p.values[k]);
    return p;
  });
}

// ----------------------------- Salud de datos -----------------------------

export type AlertLevel = 'critical' | 'warning' | 'info';
export type DataAlert = { level: AlertLevel; platform: string | null; title: string; detail: string };

export type PlatformFreshness = {
  platform: string;
  lastOrderAt: string | null;
  lastSyncRunAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
};

export function buildAlerts(input: {
  today: string;
  currentTotals: Record<string, PlatformTotals>;
  freshness: PlatformFreshness[];
  feesByPlatform: Record<string, number>;
  adsByPlatform: Record<string, number>;
  now?: Date;
}): DataAlert[] {
  const alerts: DataAlert[] = [];
  const nowMs = (input.now ?? new Date()).getTime();

  for (const platform of PANEL_PLATFORMS) {
    const label = PLATFORM_LABELS[platform];
    const totals = input.currentTotals[platform] ?? EMPTY_TOTALS;
    const fresh = input.freshness.find((f) => f.platform === platform);

    if (!fresh?.lastOrderAt) {
      alerts.push({
        level: 'critical',
        platform,
        title: `${label}: sin datos`,
        detail: 'No hay ningun pedido sincronizado de este canal. Revisa la conexion en n8n.'
      });
      continue;
    }

    const hoursSinceOrder = (nowMs - new Date(fresh.lastOrderAt).getTime()) / 3_600_000;
    if (hoursSinceOrder > 48) {
      alerts.push({
        level: 'critical',
        platform,
        title: `${label}: sin pedidos nuevos`,
        detail: `Ultimo pedido recibido hace ${Math.round(hoursSinceOrder / 24)} dias. Posible sincronizacion caida.`
      });
    }

    if (fresh.lastSyncStatus && fresh.lastSyncStatus !== 'ok') {
      alerts.push({
        level: 'critical',
        platform,
        title: `${label}: error de sincronizacion`,
        detail: fresh.lastSyncError || `Estado: ${fresh.lastSyncStatus}`
      });
    }

    const zeroBase = totals.orders + totals.pendingOrders;
    if (zeroBase > 20 && totals.zeroAmountOrders / zeroBase > 0.05) {
      const share = Math.round((totals.zeroAmountOrders / zeroBase) * 100);
      const serious = share >= 20;
      alerts.push({
        level: serious ? 'critical' : 'warning',
        platform,
        title: serious ? `${label}: pedidos sin importe` : `${label}: pedidos pendientes de cobro`,
        detail: serious
          ? `${totals.zeroAmountOrders.toLocaleString('es-ES')} pedidos (${share}%) con más de 3 días siguen sin importe (0 €). Las ventas de ${label} estan infravaloradas: revisa la sincronizacion.`
          : `${totals.zeroAmountOrders.toLocaleString('es-ES')} pedidos (${share}%) con más de 3 días siguen pendientes de cobro en ${label} y aún no suman. Se añadirán solos cuando ${label} los cobre.`
      });
    }

    if (totals.allOrders > 50 && totals.pendingOrders / totals.allOrders > 0.25) {
      alerts.push({
        level: 'warning',
        platform,
        title: `${label}: muchos pedidos pendientes`,
        detail: `${totals.pendingOrders.toLocaleString('es-ES')} pedidos con más de 3 días siguen en "pendiente" y no cuentan como venta.`
      });
    }

    if (totals.orders > 0 && !(input.feesByPlatform[platform] > 0)) {
      alerts.push({
        level: 'info',
        platform,
        title: `${label}: comisiones estimadas`,
        detail:
          platform === 'amazon'
            ? 'No hay comisiones reales de Amazon sincronizadas: el margen no las descuenta.'
            : 'No hay comisiones reales sincronizadas: se usan las tasas del panel financiero.'
      });
    }
    if (totals.orders > 0 && !(input.adsByPlatform[platform] > 0)) {
      alerts.push({
        level: 'info',
        platform,
        title: `${label}: sin gasto en publicidad`,
        detail: 'No hay gasto publicitario sincronizado: el margen no descuenta anuncios.'
      });
    }
  }

  const order: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
}

// ----------------------------- Utilidades -----------------------------

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toNum(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const n = Number(String(value));
  return Number.isFinite(n) ? n : 0;
}

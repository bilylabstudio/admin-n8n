// Logica pura del panel v2: comparacion, perfil semanal, cascada de rentabilidad e insights.

import { PLATFORM_LABELS, parseDay, isoDay, round2, type DailyPlatformRow, type DateWindow, type PanelRange } from './panel';

export type CompareMode = 'previous' | 'year';

export function shiftYear(day: string, years: number): string {
  const d = parseDay(day);
  const target = new Date(Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), 1));
  const maxDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), maxDay));
  return isoDay(target);
}

export function comparisonWindow(range: PanelRange, mode: CompareMode): { window: DateWindow; label: string } {
  if (mode === 'year') {
    return {
      window: { start: shiftYear(range.current.start, -1), end: shiftYear(range.current.end, -1) },
      label: 'vs mismo periodo del año anterior'
    };
  }
  return { window: range.previous, label: range.compareLabel };
}

// ----------------------------- Dia de la semana -----------------------------

export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export type WeekdayRow = { weekday: string; days: number; avgNet: number; avgOrders: number; byPlatform: Record<string, number> };

/** Venta neta media por dia de la semana (lunes primero), con desglose por canal. */
export function weekdayProfile(rows: DailyPlatformRow[], window: DateWindow): WeekdayRow[] {
  const dayCount = new Array(7).fill(0);
  let cursor = window.start;
  while (cursor <= window.end) {
    dayCount[(parseDay(cursor).getUTCDay() + 6) % 7] += 1;
    const d = parseDay(cursor);
    d.setUTCDate(d.getUTCDate() + 1);
    cursor = isoDay(d);
  }
  const net = new Array(7).fill(0);
  const orders = new Array(7).fill(0);
  const byPlatform: Record<string, number>[] = Array.from({ length: 7 }, () => ({}));
  for (const r of rows) {
    if (r.day < window.start || r.day > window.end) continue;
    const i = (parseDay(r.day).getUTCDay() + 6) % 7;
    net[i] += r.netSales;
    orders[i] += r.orders;
    byPlatform[i][r.platform] = (byPlatform[i][r.platform] ?? 0) + r.netSales;
  }
  return WEEKDAYS.map((weekday, i) => ({
    weekday,
    days: dayCount[i],
    avgNet: dayCount[i] ? round2(net[i] / dayCount[i]) : 0,
    avgOrders: dayCount[i] ? round2(orders[i] / dayCount[i]) : 0,
    byPlatform: Object.fromEntries(
      Object.entries(byPlatform[i]).map(([p, v]) => [p, dayCount[i] ? round2(v / dayCount[i]) : 0])
    )
  }));
}

// ----------------------------- Cascada -----------------------------

export type WaterfallStep = { label: string; value: number; kind: 'start' | 'minus' | 'subtotal' | 'end'; note?: string };

export function buildWaterfall(input: {
  grossSales: number;
  discounts: number;
  returns: number;
  otherChannelsNet: number;
  fees: number;
  productCost: number;
  ads: number;
}): WaterfallStep[] {
  const net = input.grossSales - input.discounts - input.returns + input.otherChannelsNet;
  const margin = net - input.fees - input.productCost - input.ads;
  const steps: WaterfallStep[] = [
    { label: 'Ventas brutas Shopify', value: round2(input.grossSales), kind: 'start' },
    { label: 'Descuentos', value: round2(-input.discounts), kind: 'minus' },
    { label: 'Devoluciones', value: round2(-input.returns), kind: 'minus' }
  ];
  if (input.otherChannelsNet) steps.push({ label: 'Ventas Amazon', value: round2(input.otherChannelsNet), kind: 'minus' });
  steps.push({ label: 'Ventas netas', value: round2(net), kind: 'subtotal' });
  steps.push({ label: 'Comisiones', value: round2(-input.fees), kind: 'minus', note: 'estimadas' });
  steps.push({ label: 'Coste de producto', value: round2(-input.productCost), kind: 'minus', note: 'estimado' });
  if (input.ads) steps.push({ label: 'Publicidad', value: round2(-input.ads), kind: 'minus' });
  steps.push({ label: 'Margen de contribución', value: round2(margin), kind: 'end' });
  return steps;
}

// ----------------------------- Insights -----------------------------

export type Insight = { tone: 'up' | 'down' | 'neutral'; text: string };

const eur = (v: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
const pct = (v: number) => `${Math.abs(v).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
const dayName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export function buildInsights(input: {
  hasPrevious: boolean;
  compareLabel: string;
  netSales: number;
  previousNetSales: number;
  aov: number;
  previousAov: number;
  channels: { platform: string; netSales: number; previousNetSales: number }[];
  bestDay: { day: string; netSales: number } | null;
  forecast: { projectedNet: number; previousMonthNet: number } | null;
  products: { product: string; netSales: number; previousNetSales: number }[];
}): Insight[] {
  const out: (Insight & { weight: number })[] = [];
  const change = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);

  if (input.forecast && input.forecast.previousMonthNet > 0) {
    const c = change(input.forecast.projectedNet, input.forecast.previousMonthNet)!;
    out.push({
      tone: c >= 0 ? 'up' : 'down',
      text: `Al ritmo actual el mes cerraría en ${eur(input.forecast.projectedNet)}, un ${pct(c)} ${c >= 0 ? 'por encima' : 'por debajo'} del mes anterior.`,
      weight: 100
    });
  }

  if (input.hasPrevious) {
    for (const ch of input.channels) {
      const c = change(ch.netSales, ch.previousNetSales);
      if (c === null || Math.abs(c) < 5) continue;
      out.push({
        tone: c > 0 ? 'up' : 'down',
        text: `${PLATFORM_LABELS[ch.platform] ?? ch.platform} ${c > 0 ? 'sube' : 'baja'} un ${pct(c)} (${eur(ch.netSales - ch.previousNetSales)}) ${input.compareLabel.replace(/^vs /, 'frente al ')}.`,
        weight: 60 + Math.min(30, Math.abs(c))
      });
    }
    const a = change(input.aov, input.previousAov);
    if (a !== null && Math.abs(a) >= 5) {
      out.push({
        tone: a > 0 ? 'up' : 'down',
        text: `El ticket medio ${a > 0 ? 'sube' : 'baja'} un ${pct(a)}, hasta ${eur(input.aov)} por pedido.`,
        weight: 50 + Math.min(20, Math.abs(a))
      });
    }
  }

  const movers = input.products
    .filter((p) => p.previousNetSales > 500 || p.netSales > 500)
    .map((p) => ({ ...p, diff: p.netSales - p.previousNetSales }))
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  if (input.hasPrevious && movers[0] && Math.abs(movers[0].diff) > 1000) {
    const m = movers[0];
    out.push({
      tone: m.diff > 0 ? 'up' : 'down',
      text: `${m.product} es el producto que más ${m.diff > 0 ? 'crece' : 'cae'} en Shopify: ${m.diff > 0 ? '+' : '−'}${eur(Math.abs(m.diff))}.`,
      weight: 45
    });
  }

  if (input.bestDay && input.bestDay.netSales > 0) {
    out.push({
      tone: 'neutral',
      text: `Mejor día del periodo: ${dayName(input.bestDay.day)}, con ${eur(input.bestDay.netSales)} de ventas netas.`,
      weight: 30
    });
  }

  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map(({ tone, text }) => ({ tone, text }));
}

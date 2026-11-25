import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import {
  PANEL_PLATFORMS,
  addDays,
  buildAlerts,
  buildSeries,
  contributionFor,
  forecastMonth,
  kpisFrom,
  pctChange,
  resolvePanelRange,
  round2,
  seriesGranularity,
  sumRows,
  type DailyPlatformRow,
  type DateWindow,
  type PlatformTotals
} from '@/lib/panel';
import { buildInsights, buildWaterfall, comparisonWindow, weekdayProfile, type CompareMode } from '@/lib/panel-v2';
import {
  customerMix,
  dailyRows,
  freshness,
  moneyByPlatform,
  monthlyTrend,
  shopifyProductSales,
  shopifyReport,
  topCountriesFor,
  totalsByPlatform
} from '@/lib/panel-queries';

export const dynamic = 'force-dynamic';

// El calculo en frio puede tardar mas de lo que aguanta el proxy: se calcula en segundo plano,
// se comparte entre peticiones iguales y, si tarda, se responde "pendiente" (202) para que la pagina reintente.
type Built = { status: number; body: unknown };
const inflight: Map<string, { at: number; promise: Promise<Built> }> = ((globalThis as { __panelV2?: Map<string, { at: number; promise: Promise<Built> }> }).__panelV2 ??= new Map());

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  const url = new URL(request.url);
  const key = [...url.searchParams.entries()].sort().map(([k, v]) => `${k}=${v}`).join('&');
  let entry = inflight.get(key);
  if (!entry || Date.now() - entry.at > 4 * 60_000) {
    const promise = build(url).catch((e) => ({ status: 500, body: { ok: false, error: e instanceof Error ? e.message : 'Error' } }));
    entry = { at: Date.now(), promise };
    inflight.set(key, entry);
    promise.then((r) => {
      if (r.status !== 200) inflight.delete(key);
    });
  }
  const result = await Promise.race([entry.promise, new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
  if (!result) return Response.json({ ok: false, pending: true }, { status: 202 });
  return Response.json(result.body, { status: result.status });
}

async function build(url: URL): Promise<Built> {
  const resolved = resolvePanelRange({
    preset: url.searchParams.get('preset'),
    start: url.searchParams.get('start'),
    end: url.searchParams.get('end')
  });
  if (!resolved.ok) return { status: 400, body: { ok: false, error: resolved.error } };
  const { range } = resolved;

  const compareMode: CompareMode = url.searchParams.get('compare') === 'year' ? 'year' : 'previous';
  const comparison = comparisonWindow(range, compareMode);
  const channelParam = url.searchParams.get('channel') || 'all';
  const selected: string[] = (PANEL_PLATFORMS as readonly string[]).includes(channelParam)
    ? [channelParam]
    : [...PANEL_PLATFORMS];
  const pick = (rows: DailyPlatformRow[]) => rows.filter((r) => selected.includes(r.platform));

  const thisMonth: DateWindow = { start: `${range.today.slice(0, 7)}-01`, end: range.today };
  const prevMonthEnd = addDays(thisMonth.start, -1);
  const prevMonth: DateWindow = { start: `${prevMonthEnd.slice(0, 7)}-01`, end: prevMonthEnd };
  const trendFrom = (() => {
    const d = new Date(`${thisMonth.start}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 11);
    return d.toISOString().slice(0, 7);
  })();

  const [allCur, allPrev, allMonth, allPrevMonth, curMoney, prevMoney, settings, trend, customers, countries, fresh, products, prevProducts] =
    await Promise.all([
      dailyRows(range.current),
      dailyRows(comparison.window),
      dailyRows(thisMonth),
      dailyRows(prevMonth),
      moneyByPlatform(range.current),
      moneyByPlatform(comparison.window),
      db.financialSetting.findMany({ select: { platform: true, key: true, value: true } }),
      monthlyTrend(trendFrom, range.today),
      customerMix(range.current),
      topCountriesFor(range.current, selected),
      freshness(),
      selected.includes('shopify') ? shopifyProductSales(range.current) : Promise.resolve([]),
      selected.includes('shopify') ? shopifyProductSales(comparison.window) : Promise.resolve([])
    ]);

  // Canales: siempre ambos (para comparar), aunque el filtro limite el resto del panel.
  const allCurTotals = totalsByPlatform(allCur);
  const allPrevTotals = totalsByPlatform(allPrev);
  const channels = [...PANEL_PLATFORMS].map((platform) => {
    const cur = allCurTotals[platform] ?? sumRows([]);
    const prev = allPrevTotals[platform] ?? sumRows([]);
    const contribution = contributionFor(platform, cur, curMoney, settings);
    const prevContribution = contributionFor(platform, prev, prevMoney, settings);
    return {
      platform,
      selected: selected.includes(platform),
      kpis: kpisFrom(cur, contribution.contribution),
      previous: kpisFrom(prev, prevContribution.contribution),
      contribution,
      delta: pctChange(cur.netSales, prev.netSales)
    };
  });
  const allNet = channels.reduce((a, c) => a + c.kpis.netSales, 0) || 1;

  // Totales del filtro seleccionado.
  const curRows = pick(allCur);
  const prevRows = pick(allPrev);
  const sel = channels.filter((c) => c.selected);
  const curTotals = sumRows(curRows);
  const prevTotals = sumRows(prevRows);
  const contribution = sel.reduce((a, c) => a + c.contribution.contribution, 0);
  const prevContribution = sel.reduce((a, c) => a + c.previous.contribution, 0);
  const kpis = { ...kpisFrom(curTotals, contribution), newCustomers: 0, customers: 0 };
  const previous = kpisFrom(prevTotals, prevContribution);
  const hasPrevious = previous.orders > 0;

  const selCustomers = customers.filter((c) => selected.includes(c.platform));
  kpis.customers = selCustomers.reduce((a, c) => a + c.customers, 0);
  kpis.newCustomers = selCustomers.reduce((a, c) => a + c.customers - c.returningCustomers, 0);

  const granularity = seriesGranularity(range.current);
  const points = buildSeries(curRows, range.current, granularity);
  const prevPoints = buildSeries(prevRows, comparison.window, granularity);
  const daily = buildSeries(curRows, range.current, 'day');

  // Pulso del mes (canales seleccionados): acumulado diario de este mes y del anterior.
  const sumByDay = (rows: DailyPlatformRow[]) =>
    rows.reduce<Record<string, number>>((acc, r) => ((acc[r.day] = (acc[r.day] ?? 0) + r.netSales), acc), {});
  const monthByDay = sumByDay(pick(allMonth));
  const prevMonthByDay = sumByDay(pick(allPrevMonth));
  const forecast = forecastMonth(
    Object.entries(monthByDay).map(([day, netSales]) => ({ day, netSales })),
    range.today,
    Object.values(prevMonthByDay).reduce((a, b) => a + b, 0)
  );
  const cumulative = (byDay: Record<string, number>, start: string, days: number) => {
    const out: number[] = [];
    let acc = 0;
    for (let i = 0; i < days; i++) {
      const day = addDays(start, i);
      acc += byDay[day] ?? 0;
      out.push(round2(acc));
    }
    return out;
  };
  const monthDays = Number(new Date(Date.UTC(+thisMonth.start.slice(0, 4), +thisMonth.start.slice(5, 7), 0)).getUTCDate());
  const prevMonthDays = Number(prevMonth.end.slice(8, 10));
  const elapsed = Number(range.today.slice(8, 10));
  const pulse = {
    month: thisMonth.start.slice(0, 7),
    daysInMonth: monthDays,
    today: elapsed,
    current: cumulative(monthByDay, thisMonth.start, elapsed),
    previous: cumulative(prevMonthByDay, prevMonth.start, prevMonthDays)
  };

  // Productos con comparacion.
  const prevByProduct = new Map(prevProducts.map((p) => [p.product, p]));
  const productRows = products.map((p) => ({
    ...p,
    previousNetSales: prevByProduct.get(p.product)?.netSales ?? 0,
    previousUnits: prevByProduct.get(p.product)?.units ?? 0
  }));

  const bestDay = daily
    .map((p) => ({ day: p.key, netSales: Object.values(p.values).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.netSales - a.netSales)[0] ?? null;

  const report = shopifyReport(selected.includes('shopify') ? (allCurTotals.shopify as PlatformTotals) : undefined);
  const otherNet = sel.filter((c) => c.platform !== 'shopify').reduce((a, c) => a + c.kpis.netSales, 0);
  const waterfall = buildWaterfall({
    grossSales: selected.includes('shopify') ? report.grossSales : 0,
    discounts: selected.includes('shopify') ? report.discounts : 0,
    returns: selected.includes('shopify') ? report.returns : 0,
    otherChannelsNet: otherNet,
    fees: sel.reduce((a, c) => a + c.contribution.fees, 0),
    productCost: sel.reduce((a, c) => a + c.contribution.productCost, 0),
    ads: sel.reduce((a, c) => a + c.contribution.ads, 0)
  });

  const insights = buildInsights({
    hasPrevious,
    compareLabel: comparison.label,
    netSales: kpis.netSales,
    previousNetSales: previous.netSales,
    aov: kpis.aov,
    previousAov: previous.aov,
    channels: sel.map((c) => ({ platform: c.platform, netSales: c.kpis.netSales, previousNetSales: c.previous.netSales })),
    bestDay,
    forecast: range.current.end === range.today ? forecast : null,
    products: productRows
  });

  return { status: 200, body: {
    ok: true,
    range,
    compare: { mode: compareMode, window: comparison.window, label: comparison.label },
    channel: channelParam,
    hasPrevious,
    kpis,
    previous,
    deltas: {
      netSales: pctChange(kpis.netSales, previous.netSales),
      totalSales: pctChange(kpis.grossSales, previous.grossSales),
      orders: pctChange(kpis.orders, previous.orders),
      aov: pctChange(kpis.aov, previous.aov),
      units: pctChange(kpis.units, previous.units),
      contribution: pctChange(kpis.contribution, previous.contribution),
      refundRate: hasPrevious ? round2(kpis.refundRate - previous.refundRate) : null
    },
    channels: channels.map((c) => ({ ...c, share: round2((c.kpis.netSales / allNet) * 100) })),
    shopifyReport: {
      current: report,
      previous: shopifyReport(selected.includes('shopify') ? (allPrevTotals.shopify as PlatformTotals) : undefined)
    },
    waterfall,
    forecast,
    pulse,
    insights,
    series: { granularity, points, previous: prevPoints },
    daily,
    weekdays: weekdayProfile(curRows, range.current),
    products: productRows,
    trend: trend.filter((t) => selected.includes(t.platform)),
    customers: selCustomers,
    countries,
    freshness: fresh,
    alerts: buildAlerts({
      today: range.today,
      currentTotals: allCurTotals,
      freshness: fresh,
      feesByPlatform: curMoney.feesByPlatform,
      adsByPlatform: curMoney.adsByPlatform
    })
  } };
}

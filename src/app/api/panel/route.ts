import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import {
  PANEL_PLATFORMS,
  PANEL_TIME_ZONE,
  SALE_STATUSES,
  addDays,
  buildAlerts,
  buildSeries,
  contributionFor,
  forecastMonth,
  inWindow,
  kpisFrom,
  pctChange,
  resolvePanelRange,
  round2,
  seriesGranularity,
  sumRows,
  toNum,
  type DailyPlatformRow,
  type DateWindow,
  type PlatformTotals
} from '@/lib/panel';

export const dynamic = 'force-dynamic';

const TZ = PANEL_TIME_ZONE;

// Venta neta sin IVA y facturacion con IVA, con el mismo criterio que el panel financiero:
// Shopify/TikTok llevan el IVA dentro del subtotal; en Amazon el subtotal es sin IVA.
const NET_SQL = Prisma.sql`CASE WHEN platform = 'amazon'
  THEN subtotal + "totalShipping" - "totalRefunded"
  ELSE subtotal + "totalShipping" - "totalTax" - "totalRefunded" END`;
const GROSS_SQL = Prisma.sql`CASE WHEN platform = 'amazon'
  THEN subtotal + "totalShipping" + "totalTax"
  ELSE subtotal + "totalShipping" END`;
const IS_SALE = Prisma.sql`"financialStatus" IN (${Prisma.join(SALE_STATUSES)})`;

// Margen de un dia a cada lado para cubrir el desfase UTC/Madrid y aprovechar el indice.
function utcBounds(w: DateWindow): { from: Date; to: Date } {
  return { from: new Date(`${addDays(w.start, -1)}T00:00:00Z`), to: new Date(`${addDays(w.end, 2)}T00:00:00Z`) };
}

async function dailyRows(w: DateWindow): Promise<DailyPlatformRow[]> {
  const { from, to } = utcBounds(w);
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT to_char(("processedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day,
           platform,
           count(*) FILTER (WHERE ${IS_SALE}) AS orders,
           coalesce(sum("totalUnits") FILTER (WHERE ${IS_SALE}), 0) AS units,
           coalesce(sum(${GROSS_SQL}) FILTER (WHERE ${IS_SALE}), 0) AS gross,
           coalesce(sum(${NET_SQL}) FILTER (WHERE ${IS_SALE}), 0) AS net,
           coalesce(sum("totalRefunded"), 0) AS refunded,
           count(*) FILTER (WHERE "totalRefunded" > 0 OR "financialStatus" IN ('refunded', 'partially_refunded')) AS refunded_orders,
           count(*) AS all_orders,
           count(*) FILTER (WHERE "financialStatus" = 'pending') AS pending_orders,
           count(*) FILTER (WHERE "totalPrice" = 0 AND ("financialStatus" = 'pending' OR ${IS_SALE})) AS zero_orders
    FROM "PlatformOrder"
    WHERE "processedAt" >= ${from} AND "processedAt" < ${to}
      AND "cancelledAt" IS NULL AND "isTest" = false
      AND "financialStatus" <> 'voided'
    GROUP BY 1, 2`;

  return rows
    .map((r) => ({
      day: String(r.day),
      platform: String(r.platform),
      orders: toNum(r.orders),
      units: toNum(r.units),
      grossSales: toNum(r.gross),
      netSales: toNum(r.net),
      refunded: toNum(r.refunded),
      refundedOrders: toNum(r.refunded_orders),
      allOrders: toNum(r.all_orders),
      pendingOrders: toNum(r.pending_orders),
      zeroAmountOrders: toNum(r.zero_orders)
    }))
    .filter((r) => inWindow(r.day, w));
}

async function moneyByPlatform(w: DateWindow) {
  const { from, to } = utcBounds(w);
  const [fees, ads] = await Promise.all([
    db.$queryRaw<{ platform: string; amount: unknown }[]>`
      SELECT platform, coalesce(sum(abs("feeAmount")), 0) AS amount
      FROM "PlatformFinancialTransaction"
      WHERE "postedAt" >= ${from} AND "postedAt" < ${to}
        AND to_char(("postedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD') BETWEEN ${w.start} AND ${w.end}
      GROUP BY 1`,
    db.$queryRaw<{ platform: string; amount: unknown }[]>`
      SELECT platform, coalesce(sum("spendAmount"), 0) AS amount
      FROM "PlatformMarketingSpend"
      WHERE date >= ${from} AND date < ${to}
        AND to_char(date, 'YYYY-MM-DD') BETWEEN ${w.start} AND ${w.end}
      GROUP BY 1`
  ]);
  const toMap = (rows: { platform: string; amount: unknown }[]) =>
    Object.fromEntries(rows.map((r) => [r.platform, toNum(r.amount)]));
  return { feesByPlatform: toMap(fees), adsByPlatform: toMap(ads) };
}

async function monthlyTrend(fromMonth: string) {
  const from = new Date(`${addDays(`${fromMonth}-01`, -1)}T00:00:00Z`);
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT to_char(("processedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM') AS month,
           platform,
           count(*) AS orders,
           coalesce(sum(${NET_SQL}), 0) AS net
    FROM "PlatformOrder"
    WHERE "processedAt" >= ${from}
      AND "cancelledAt" IS NULL AND "isTest" = false AND ${IS_SALE}
    GROUP BY 1, 2
    ORDER BY 1`;
  return rows
    .map((r) => ({ month: String(r.month), platform: String(r.platform), orders: toNum(r.orders), net: toNum(r.net) }))
    .filter((r) => r.month >= fromMonth);
}

async function customerMix(w: DateWindow) {
  const { from, to } = utcBounds(w);
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    WITH cur AS (
      SELECT platform, "customerEmail" AS email,
             count(*) AS orders,
             sum(${NET_SQL}) AS net,
             min("processedAt") AS first_in_window
      FROM "PlatformOrder"
      WHERE "processedAt" >= ${from} AND "processedAt" < ${to}
        AND to_char(("processedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD') BETWEEN ${w.start} AND ${w.end}
        AND "cancelledAt" IS NULL AND "isTest" = false AND ${IS_SALE}
        AND "customerEmail" IS NOT NULL AND "customerEmail" <> ''
      GROUP BY 1, 2
    )
    SELECT cur.platform,
           count(*) AS customers,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM "PlatformOrder" p
             WHERE p."customerEmail" = cur.email AND p."processedAt" < cur.first_in_window
               AND p."cancelledAt" IS NULL AND p."isTest" = false
               AND p."financialStatus" IN (${Prisma.join(SALE_STATUSES)})
           )) AS returning_customers,
           count(*) FILTER (WHERE cur.orders > 1) AS multi_order_customers,
           coalesce(sum(cur.net), 0) AS net
    FROM cur
    GROUP BY 1`;
  return rows.map((r) => ({
    platform: String(r.platform),
    customers: toNum(r.customers),
    returningCustomers: toNum(r.returning_customers),
    multiOrderCustomers: toNum(r.multi_order_customers),
    netSales: round2(toNum(r.net))
  }));
}

async function topCountries(w: DateWindow) {
  const { from, to } = utcBounds(w);
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT coalesce(nullif(upper("countryCode"), ''), '??') AS country,
           count(*) AS orders,
           coalesce(sum(${NET_SQL}), 0) AS net
    FROM "PlatformOrder"
    WHERE "processedAt" >= ${from} AND "processedAt" < ${to}
      AND to_char(("processedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD') BETWEEN ${w.start} AND ${w.end}
      AND "cancelledAt" IS NULL AND "isTest" = false AND ${IS_SALE}
    GROUP BY 1
    ORDER BY 3 DESC
    LIMIT 8`;
  return rows.map((r) => ({ country: String(r.country), orders: toNum(r.orders), netSales: round2(toNum(r.net)) }));
}

async function freshness() {
  const [orders, sync] = await Promise.all([
    db.$queryRaw<{ platform: string; last_order: Date | null }[]>`
      SELECT platform, max("processedAt") AS last_order FROM "PlatformOrder" GROUP BY 1`,
    db.platformSyncState.findMany()
  ]);
  return PANEL_PLATFORMS.map((platform) => {
    const states = sync.filter((s) => s.platform === platform || s.platform.startsWith(`${platform}_`));
    const latest = states
      .filter((s) => !s.platform.includes('backfill'))
      .sort((a, b) => (b.lastSyncRunAt?.getTime() ?? 0) - (a.lastSyncRunAt?.getTime() ?? 0))[0];
    const lastOrder = orders.find((o) => o.platform === platform)?.last_order ?? null;
    return {
      platform,
      lastOrderAt: lastOrder ? new Date(lastOrder).toISOString() : null,
      lastSyncRunAt: latest?.lastSyncRunAt?.toISOString() ?? null,
      lastSyncStatus: latest?.lastSyncStatus ?? null,
      lastSyncError: latest?.lastSyncError ?? null
    };
  });
}

function totalsByPlatform(rows: DailyPlatformRow[]): Record<string, PlatformTotals> {
  const out: Record<string, PlatformTotals> = {};
  for (const platform of new Set([...PANEL_PLATFORMS, ...rows.map((r) => r.platform)])) {
    out[platform] = sumRows(rows.filter((r) => r.platform === platform));
  }
  return out;
}

export async function GET(request: Request) {
  // De momento basta con el login del inbox (sin contraseña de ventas). Ver src/app/panel/page.tsx.
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });

  const url = new URL(request.url);
  const resolved = resolvePanelRange({
    preset: url.searchParams.get('preset'),
    start: url.searchParams.get('start'),
    end: url.searchParams.get('end')
  });
  if (!resolved.ok) return Response.json({ ok: false, error: resolved.error }, { status: 400 });
  const { range } = resolved;

  // Mes en curso completo (para la prevision) y mes anterior completo.
  const thisMonth: DateWindow = { start: `${range.today.slice(0, 7)}-01`, end: range.today };
  const prevMonthEnd = addDays(thisMonth.start, -1);
  const prevMonth: DateWindow = { start: `${prevMonthEnd.slice(0, 7)}-01`, end: prevMonthEnd };
  const trendFrom = (() => {
    const d = new Date(`${thisMonth.start}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 11);
    return d.toISOString().slice(0, 7);
  })();

  const [currentRows, previousRows, monthRows, prevMonthRows, curMoney, prevMoney, settings, trend, customers, countries, fresh] =
    await Promise.all([
      dailyRows(range.current),
      dailyRows(range.previous),
      dailyRows(thisMonth),
      dailyRows(prevMonth),
      moneyByPlatform(range.current),
      moneyByPlatform(range.previous),
      db.financialSetting.findMany({ select: { platform: true, key: true, value: true } }),
      monthlyTrend(trendFrom),
      customerMix(range.current),
      topCountries(range.current),
      freshness()
    ]);

  const curTotals = totalsByPlatform(currentRows);
  const prevTotals = totalsByPlatform(previousRows);
  const platforms = [...new Set([...PANEL_PLATFORMS, ...Object.keys(curTotals)])];

  const channels = platforms.map((platform) => {
    const cur = curTotals[platform];
    const prev = prevTotals[platform];
    const contribution = contributionFor(platform, cur, curMoney, settings);
    const prevContribution = contributionFor(platform, prev, prevMoney, settings);
    return {
      platform,
      kpis: kpisFrom(cur, contribution.contribution),
      previous: kpisFrom(prev, prevContribution.contribution),
      contribution,
      pendingOrders: cur.pendingOrders,
      zeroAmountOrders: cur.zeroAmountOrders
    };
  });

  const sumAll = (t: Record<string, PlatformTotals>) => sumRows(
    Object.entries(t).map(([platform, v]) => ({ day: '', platform, ...v }))
  );
  const totalContribution = channels.reduce((a, c) => a + c.contribution.contribution, 0);
  const prevTotalContribution = platforms.reduce(
    (a, p) => a + contributionFor(p, prevTotals[p], prevMoney, settings).contribution,
    0
  );
  const kpis = kpisFrom(sumAll(curTotals), totalContribution);
  const previous = kpisFrom(sumAll(prevTotals), prevTotalContribution);
  const hasPrevious = previous.orders > 0;

  const totalNet = kpis.netSales || 1;
  const granularity = seriesGranularity(range.current);

  const monthDaily = Object.values(
    monthRows.reduce<Record<string, { day: string; netSales: number }>>((acc, r) => {
      acc[r.day] = acc[r.day] || { day: r.day, netSales: 0 };
      acc[r.day].netSales += r.netSales;
      return acc;
    }, {})
  );
  const forecast = forecastMonth(monthDaily, range.today, sumRows(prevMonthRows).netSales);

  const totalFees = Object.values(curMoney.feesByPlatform).reduce((a, b) => a + b, 0);
  const totalAds = Object.values(curMoney.adsByPlatform).reduce((a, b) => a + b, 0);

  return Response.json({
    ok: true,
    range,
    hasPrevious,
    kpis,
    previous,
    deltas: {
      netSales: pctChange(kpis.netSales, previous.netSales),
      grossSales: pctChange(kpis.grossSales, previous.grossSales),
      orders: pctChange(kpis.orders, previous.orders),
      aov: pctChange(kpis.aov, previous.aov),
      contribution: pctChange(kpis.contribution, previous.contribution),
      refundRate: hasPrevious ? round2(kpis.refundRate - previous.refundRate) : null
    },
    channels: channels.map((c) => ({
      ...c,
      share: round2((c.kpis.netSales / totalNet) * 100),
      delta: pctChange(c.kpis.netSales, c.previous.netSales)
    })),
    marketing: {
      totalAds: round2(totalAds),
      totalFees: round2(totalFees),
      mer: totalAds > 0 ? round2(kpis.netSales / totalAds) : null
    },
    forecast,
    series: { granularity, points: buildSeries(currentRows, range.current, granularity) },
    trend,
    customers,
    countries,
    freshness: fresh,
    alerts: buildAlerts({
      today: range.today,
      currentTotals: curTotals,
      freshness: fresh,
      feesByPlatform: curMoney.feesByPlatform,
      adsByPlatform: curMoney.adsByPlatform
    })
  });
}

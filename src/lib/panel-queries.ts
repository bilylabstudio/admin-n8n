// Consultas compartidas del panel v2 (copiadas del panel v1 para no tocarlo).
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import {
  HIDDEN_PANEL_PLATFORMS,
  PANEL_PLATFORMS,
  isHiddenPlatform,
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
import { shopifyDailyRows } from '@/app/api/panel/shopify-sales';


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
// Excluye los canales ocultos del panel (p. ej. TikTok Shop).
const VISIBLE = HIDDEN_PANEL_PLATFORMS.length
  ? Prisma.sql`platform NOT IN (${Prisma.join([...HIDDEN_PANEL_PLATFORMS])})`
  : Prisma.sql`TRUE`;

// Margen de un dia a cada lado para cubrir el desfase UTC/Madrid y aprovechar el indice.
export function utcBounds(w: DateWindow): { from: Date; to: Date } {
  return { from: new Date(`${addDays(w.start, -1)}T00:00:00Z`), to: new Date(`${addDays(w.end, 2)}T00:00:00Z`) };
}

// Cache corto en memoria: el calculo de Shopify recorre el JSON de cada pedido.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
export function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as Promise<T>;
  const value = fn().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return value;
}

export async function dailyRows(w: DateWindow): Promise<DailyPlatformRow[]> {
  return cached(`daily:${w.start}:${w.end}`, async () => {
    const [shopify, others] = await Promise.all([shopifyDailyRows(w), otherPlatformRows(w)]);
    return [...shopify, ...others];
  });
}

// Amazon / TikTok: criterio del panel financiero (pedidos cobrados, sin IVA).
export async function otherPlatformRows(w: DateWindow): Promise<DailyPlatformRow[]> {
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
           -- Solo pedidos de mas de 3 dias: los recientes pendientes de cobro son normales (Amazon).
           count(*) FILTER (WHERE "financialStatus" = 'pending' AND "processedAt" < now() - interval '3 days') AS pending_orders,
           count(*) FILTER (WHERE "totalPrice" = 0 AND ("financialStatus" = 'pending' OR ${IS_SALE}) AND "processedAt" < now() - interval '3 days') AS zero_orders
    FROM "PlatformOrder"
    WHERE "processedAt" >= ${from} AND "processedAt" < ${to}
      AND platform <> 'shopify' AND ${VISIBLE}
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

export async function moneyByPlatform(w: DateWindow) {
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

export async function monthlyTrend(fromMonth: string, today: string) {
  return cached(`trend:${fromMonth}:${today}`, async () => {
    const [shopify, others] = await Promise.all([
      shopifyDailyRows({ start: `${fromMonth}-01`, end: today }),
      otherMonthlyTrend(fromMonth)
    ]);
    const months = new Map<string, { month: string; platform: string; orders: number; net: number }>();
    for (const row of shopify) {
      const month = row.day.slice(0, 7);
      const cur = months.get(month) ?? { month, platform: 'shopify', orders: 0, net: 0 };
      cur.orders += row.orders;
      cur.net += row.netSales;
      months.set(month, cur);
    }
    return [...months.values(), ...others].sort((a, b) => a.month.localeCompare(b.month));
  });
}

export async function otherMonthlyTrend(fromMonth: string) {
  const from = new Date(`${addDays(`${fromMonth}-01`, -1)}T00:00:00Z`);
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT to_char(("processedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM') AS month,
           platform,
           count(*) AS orders,
           coalesce(sum(${NET_SQL}), 0) AS net
    FROM "PlatformOrder"
    WHERE "processedAt" >= ${from} AND platform <> 'shopify' AND ${VISIBLE}
      AND "cancelledAt" IS NULL AND "isTest" = false AND ${IS_SALE}
    GROUP BY 1, 2
    ORDER BY 1`;
  return rows
    .map((r) => ({ month: String(r.month), platform: String(r.platform), orders: toNum(r.orders), net: toNum(r.net) }))
    .filter((r) => r.month >= fromMonth);
}

export async function customerMix(w: DateWindow) {
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
        AND "cancelledAt" IS NULL AND "isTest" = false AND ${IS_SALE} AND ${VISIBLE}
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

export async function topCountries(w: DateWindow) {
  const { from, to } = utcBounds(w);
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT coalesce(nullif(upper("countryCode"), ''), '??') AS country,
           count(*) AS orders,
           coalesce(sum(${NET_SQL}), 0) AS net
    FROM "PlatformOrder"
    WHERE "processedAt" >= ${from} AND "processedAt" < ${to}
      AND to_char(("processedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD') BETWEEN ${w.start} AND ${w.end}
      AND "cancelledAt" IS NULL AND "isTest" = false AND ${IS_SALE} AND ${VISIBLE}
    GROUP BY 1
    ORDER BY 3 DESC
    LIMIT 8`;
  return rows.map((r) => ({ country: String(r.country), orders: toNum(r.orders), netSales: round2(toNum(r.net)) }));
}

export async function freshness() {
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

export function shopifyReport(t: PlatformTotals | undefined) {
  const v = t ?? sumRows([]);
  return {
    orders: v.orders,
    units: v.units,
    grossSales: round2(v.productGross),
    discounts: round2(v.discounts),
    returns: round2(v.returns),
    netSales: round2(v.netSales),
    taxes: round2(v.taxes),
    totalSales: round2(v.netSales + v.taxes),
    shipping: round2(v.shipping)
  };
}

export function totalsByPlatform(rows: DailyPlatformRow[]): Record<string, PlatformTotals> {
  const out: Record<string, PlatformTotals> = {};
  for (const platform of new Set([...PANEL_PLATFORMS, ...rows.map((r) => r.platform)].filter((p) => !isHiddenPlatform(p)))) {
    out[platform] = sumRows(rows.filter((r) => r.platform === platform));
  }
  return out;
}


// ----------------------------- Productos (Shopify) -----------------------------

export type ProductRow = {
  product: string;
  netSales: number;
  units: number;
  orders: number;
};

/**
 * Ventas netas por producto en Shopify (sin IVA, con descuentos), por fecha del pedido.
 * Agrupa por titulo de producto (sin variante). Amazon no trae lineas de producto en la API de pedidos.
 */
export async function shopifyProductSales(w: DateWindow): Promise<ProductRow[]> {
  return cached(`products:${w.start}:${w.end}`, async () => {
    const { from, to } = utcBounds(w);
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT coalesce(nullif(li->>'title', ''), 'Sin nombre') AS product,
             sum((li->>'price')::numeric * (li->>'quantity')::int - x.d - x.t) AS net,
             sum((li->>'quantity')::int) AS units,
             count(DISTINCT o.id) AS orders
      FROM "PlatformOrder" o
      CROSS JOIN LATERAL jsonb_array_elements(o."rawJson"::jsonb->'line_items') li
      CROSS JOIN LATERAL (
        SELECT coalesce((SELECT sum((a->>'amount')::numeric) FROM jsonb_array_elements(li->'discount_allocations') a), 0) AS d,
               coalesce((SELECT sum((t->>'price')::numeric) FROM jsonb_array_elements(li->'tax_lines') t), 0) AS t
      ) x
      WHERE o.platform = 'shopify' AND o."isTest" = false AND o."rawJson" IS NOT NULL
        AND o."processedAt" >= ${from} AND o."processedAt" < ${to}
        AND to_char((o."processedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD') BETWEEN ${w.start} AND ${w.end}
        AND coalesce((li->>'gift_card')::boolean, false) = false
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 40`;
    return rows.map((r) => ({
      product: String(r.product),
      netSales: round2(toNum(r.net)),
      units: toNum(r.units),
      orders: toNum(r.orders)
    }));
  });
}

export async function topCountriesFor(w: DateWindow, platforms: string[]) {
  const { from, to } = utcBounds(w);
  if (!platforms.length) return [];
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT coalesce(nullif(upper("countryCode"), ''), '??') AS country,
           count(*) AS orders,
           coalesce(sum(${NET_SQL}), 0) AS net
    FROM "PlatformOrder"
    WHERE "processedAt" >= ${from} AND "processedAt" < ${to}
      AND to_char(("processedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD') BETWEEN ${w.start} AND ${w.end}
      AND "cancelledAt" IS NULL AND "isTest" = false AND ${IS_SALE}
      AND platform IN (${Prisma.join(platforms)})
    GROUP BY 1
    ORDER BY 3 DESC
    LIMIT 10`;
  return rows.map((r) => ({ country: String(r.country), orders: toNum(r.orders), netSales: round2(toNum(r.net)) }));
}

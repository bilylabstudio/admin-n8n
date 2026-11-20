import { db } from '@/lib/db';
import { PANEL_TIME_ZONE, addDays, inWindow, round2, toNum, type DailyPlatformRow, type DateWindow } from '@/lib/panel';

// Ventas de Shopify con el MISMO criterio que el informe de Shopify
// "Copia de ventas por variante de producto" (tienda con precios IVA incluido):
//   ventas brutas  = precio x cantidad de cada linea, sin IVA
//   descuentos     = descuentos asignados a las lineas, sin IVA
//   devoluciones   = lineas reembolsadas/canceladas, sin IVA, en la FECHA DEL REEMBOLSO
//   ventas netas   = brutas - descuentos - devoluciones   (sin envios)
//   impuestos      = IVA de las ventas - IVA devuelto
//   ventas totales = netas + impuestos
// Las ventas cuentan el dia del pedido (aunque luego se cancele o este pendiente de pago),
// igual que en Shopify. Se excluyen solo los pedidos de prueba y las tarjetas regalo.
// Pedidos sin rawJson (anteriores a mayo 2026) usan una aproximacion con las columnas.

const TZ = PANEL_TIME_ZONE;
// Ventana hacia atras para encontrar reembolsos de pedidos antiguos.
const REFUND_LOOKBACK_DAYS = 400;

export async function shopifyDailyRows(w: DateWindow): Promise<DailyPlatformRow[]> {
  const from = new Date(`${addDays(w.start, -1)}T00:00:00Z`);
  const to = new Date(`${addDays(w.end, 2)}T00:00:00Z`);
  const refundOrdersFrom = new Date(`${addDays(w.start, -REFUND_LOOKBACK_DAYS)}T00:00:00Z`);

  const [sales, returns] = await Promise.all([
    db.$queryRaw<Record<string, unknown>[]>`
      WITH ord AS (
        SELECT id, "processedAt" AS p, "rawJson"::jsonb AS j, subtotal, "totalShipping" AS ship,
               "totalTax" AS tax, "totalDiscounts" AS disc, "totalRefunded" AS ref, "totalUnits" AS units,
               "financialStatus" AS st, "totalPrice" AS price
        FROM "PlatformOrder"
        WHERE platform = 'shopify' AND "isTest" = false
          AND "processedAt" >= ${from} AND "processedAt" < ${to}
      ),
      lines AS (
        SELECT o.id,
               sum((li->>'quantity')::int) AS units,
               sum((li->>'price')::numeric * (li->>'quantity')::int - x.d - x.t) AS net,
               sum(x.d / (1 + x.r)) AS disc,
               sum(x.t) AS tax
        FROM ord o
        CROSS JOIN LATERAL jsonb_array_elements(o.j->'line_items') li
        CROSS JOIN LATERAL (
          SELECT coalesce((SELECT sum((a->>'amount')::numeric) FROM jsonb_array_elements(li->'discount_allocations') a), 0) AS d,
                 coalesce((SELECT sum((t->>'price')::numeric) FROM jsonb_array_elements(li->'tax_lines') t), 0) AS t,
                 coalesce((li->'tax_lines'->0->>'rate')::numeric, 0) AS r
        ) x
        WHERE o.j IS NOT NULL AND coalesce((li->>'gift_card')::boolean, false) = false
        GROUP BY o.id
      )
      SELECT to_char((o.p AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day,
             count(*) AS orders,
             coalesce(sum(coalesce(l.units, o.units)), 0) AS units,
             coalesce(sum(CASE WHEN l.id IS NOT NULL THEN l.net
                          ELSE o.subtotal - CASE WHEN o.subtotal + o.ship > 0 THEN o.tax * o.subtotal / (o.subtotal + o.ship) ELSE 0 END END), 0) AS net,
             coalesce(sum(CASE WHEN l.id IS NOT NULL THEN l.disc
                          ELSE o.disc / 1.1 END), 0) AS disc,
             coalesce(sum(CASE WHEN l.id IS NOT NULL THEN l.tax
                          ELSE CASE WHEN o.subtotal + o.ship > 0 THEN o.tax * o.subtotal / (o.subtotal + o.ship) ELSE 0 END END), 0) AS tax,
             coalesce(sum(CASE WHEN l.id IS NULL THEN o.ref / 1.1 ELSE 0 END), 0) AS legacy_returns,
             coalesce(sum(o.ship), 0) AS ship,
             count(*) FILTER (WHERE o.st = 'pending') AS pending_orders,
             count(*) FILTER (WHERE o.price = 0) AS zero_orders
      FROM ord o LEFT JOIN lines l ON l.id = o.id
      GROUP BY 1`,
    db.$queryRaw<Record<string, unknown>[]>`
      SELECT to_char(((r->>'created_at')::timestamptz) AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day,
             count(DISTINCT r->>'id') AS refunds,
             coalesce(sum((rli->>'subtotal')::numeric - coalesce((rli->>'total_tax')::numeric, 0)), 0) AS ret,
             coalesce(sum(coalesce((rli->>'total_tax')::numeric, 0)), 0) AS ret_tax
      FROM "PlatformOrder" o
      CROSS JOIN LATERAL jsonb_array_elements(o."rawJson"::jsonb->'refunds') r
      CROSS JOIN LATERAL jsonb_array_elements(r->'refund_line_items') rli
      WHERE o.platform = 'shopify' AND o."isTest" = false
        AND o."processedAt" >= ${refundOrdersFrom} AND o."processedAt" < ${to}
        AND o."rawJson" IS NOT NULL
        AND (r->>'created_at')::timestamptz >= ${from} AND (r->>'created_at')::timestamptz < ${to}
        AND coalesce((rli->'line_item'->>'gift_card')::boolean, false) = false
      GROUP BY 1`
  ]);

  const byDay = new Map<string, DailyPlatformRow>();
  const get = (day: string) => {
    let row = byDay.get(day);
    if (!row) {
      row = {
        day,
        platform: 'shopify',
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
      byDay.set(day, row);
    }
    return row;
  };

  for (const s of sales) {
    const row = get(String(s.day));
    const net = toNum(s.net);
    const disc = toNum(s.disc);
    const legacyReturns = toNum(s.legacy_returns);
    row.orders = toNum(s.orders);
    row.allOrders = row.orders;
    row.units = toNum(s.units);
    row.productGross = net + disc;
    row.discounts = disc;
    row.returns = (row.returns ?? 0) + legacyReturns;
    row.taxes = (row.taxes ?? 0) + toNum(s.tax);
    row.shipping = toNum(s.ship);
    row.pendingOrders = toNum(s.pending_orders);
    row.zeroAmountOrders = toNum(s.zero_orders);
  }
  for (const r of returns) {
    const row = get(String(r.day));
    row.returns = (row.returns ?? 0) + toNum(r.ret);
    row.taxes = (row.taxes ?? 0) - toNum(r.ret_tax);
    row.refundedOrders += toNum(r.refunds);
  }

  return [...byDay.values()]
    .filter((row) => inWindow(row.day, w))
    .map((row) => {
      const netSales = (row.productGross ?? 0) - (row.discounts ?? 0) - (row.returns ?? 0);
      return {
        ...row,
        productGross: round2(row.productGross ?? 0),
        discounts: round2(row.discounts ?? 0),
        returns: round2(row.returns ?? 0),
        taxes: round2(row.taxes ?? 0),
        shipping: round2(row.shipping ?? 0),
        netSales: round2(netSales),
        grossSales: round2(netSales + (row.taxes ?? 0)),
        refunded: round2(row.returns ?? 0)
      };
    });
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const decimalString = z.union([z.number(), z.string()]).transform((value) => String(value));

const itemSchema = z.object({
  external_order_id: z.string().min(1),
  subtotal: decimalString.optional(),
  total_tax: decimalString.optional(),
  total_shipping: decimalString.optional(),
  total_refunded: decimalString.optional()
});

const batchSchema = z.object({ items: z.array(itemSchema).min(1) });

// Actualiza SOLO los importes (subtotal/IVA/envio/devolucion) de pedidos de Amazon ya existentes,
// emparejando por externalOrderId. NO toca processedAt (fecha de compra de getOrders), totalUnits
// ni el estado. Lo alimenta el flujo de Finanzas para cuadrar ventas-sin-IVA. Si el pedido no
// existe todavia (no cargado por getOrders), se cuenta como "missing" y no se crea.
export async function POST(request: Request) {
  const token = request.headers.get('x-n8n-ingest-token') || '';
  if (token !== env.N8N_INGEST_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const payload = Array.isArray(body)
    ? { items: body }
    : Array.isArray(body?.items)
      ? body
      : { items: [body] };
  const parsed = batchSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  let updated = 0;
  let missing = 0;
  for (const item of parsed.data.items) {
    const data: Record<string, string> = {};
    if (item.subtotal !== undefined) data.subtotal = item.subtotal;
    if (item.total_tax !== undefined) data.totalTax = item.total_tax;
    if (item.total_shipping !== undefined) data.totalShipping = item.total_shipping;
    if (item.total_refunded !== undefined) data.totalRefunded = item.total_refunded;
    if (Object.keys(data).length === 0) continue;

    const result = await db.platformOrder.updateMany({
      where: { platform: 'amazon', externalOrderId: item.external_order_id },
      data
    });
    if (result.count > 0) updated += result.count;
    else missing += 1;
  }

  return NextResponse.json({ ok: true, updated, missing });
}

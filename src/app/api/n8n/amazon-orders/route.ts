import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { parseAmazonOrdersTsv } from '@/lib/amazon-orders';
import { upsertPlatformOrders } from '@/lib/platform-orders';

export const dynamic = 'force-dynamic';

// Ingesta del informe de pedidos de Amazon (flat-file
// GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL) por FECHA DE COMPRA y completo.
// El workflow n8n descarga el informe (TSV) y lo postea aqui; se parsea con parseAmazonOrdersTsv
// y se upserta en PlatformOrder (platform 'amazon'). Esto reemplaza, para ventas/unidades, la
// derivacion desde SP-API Finanzas (que fechaba por liquidacion y quedaba incompleta).
export async function POST(request: Request) {
  const token = request.headers.get('x-n8n-ingest-token') || '';
  if (token !== env.N8N_INGEST_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const tsv =
    typeof body === 'string'
      ? body
      : typeof body?.tsv === 'string'
        ? body.tsv
        : typeof body?.report === 'string'
          ? body.report
          : '';

  if (!tsv.trim()) {
    return NextResponse.json({ ok: false, error: 'missing_tsv' }, { status: 400 });
  }

  const parsed = parseAmazonOrdersTsv(tsv);

  let processed = 0;
  const chunkSize = 100;
  for (let index = 0; index < parsed.orders.length; index += chunkSize) {
    const chunk = parsed.orders.slice(index, index + chunkSize);
    processed += (await upsertPlatformOrders(chunk)).length;
  }

  return NextResponse.json({
    ok: true,
    processed,
    orders_parsed: parsed.orders.length,
    rows_skipped: parsed.rowsSkipped.length
  });
}

import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { ordersBatchSchema, upsertPlatformOrders } from '@/lib/platform-orders';

export async function POST(request: Request) {
  const token = request.headers.get('x-n8n-ingest-token') || '';
  if (token !== env.N8N_INGEST_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const payload = Array.isArray(body) ? { orders: body } : Array.isArray(body?.orders) ? body : { orders: [body] };
  const parsed = ordersBatchSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const results = await upsertPlatformOrders(parsed.data.orders);
  return NextResponse.json({ ok: true, processed: results.length });
}

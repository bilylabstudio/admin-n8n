import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { getSyncCursor } from '@/lib/platform-orders';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const token = request.headers.get('x-n8n-ingest-token') || '';
  if (token !== env.N8N_INGEST_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || 'shopify';
  const cursor = await getSyncCursor(platform);
  return NextResponse.json({ ok: true, ...cursor });
}

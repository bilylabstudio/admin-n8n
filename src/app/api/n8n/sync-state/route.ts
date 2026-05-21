import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { markSyncState, syncStateInputSchema } from '@/lib/platform-orders';

export async function POST(request: Request) {
  const token = request.headers.get('x-n8n-ingest-token') || '';
  if (token !== env.N8N_INGEST_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = syncStateInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const state = await markSyncState(parsed.data);
  return NextResponse.json({
    ok: true,
    platform: state.platform,
    lastUpdatedAt: state.lastUpdatedAt?.toISOString() ?? null,
    lastSyncStatus: state.lastSyncStatus
  });
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('x-n8n-ingest-token') || request.headers.get('X-N8N-Ingest-Token') || '';
  const expectedToken = env.N8N_INGEST_SECRET;
  if (expectedToken && authHeader !== expectedToken) {
    return NextResponse.json({ ok: false, blocked: false }, { status: 401 });
  }

  const url = new URL(request.url);
  const email = (url.searchParams.get('email') || '').toLowerCase().trim();

  if (!email) return NextResponse.json({ ok: true, blocked: false });

  const entry = await db.blockedEmail.findUnique({ where: { email } });
  return NextResponse.json({ ok: true, blocked: entry !== null });
}

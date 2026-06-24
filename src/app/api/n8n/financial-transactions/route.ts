import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import {
  financialTransactionsBatchSchema,
  upsertPlatformFinancialTransactions
} from '@/lib/platform-financial-transactions';

export async function POST(request: Request) {
  const token = request.headers.get('x-n8n-ingest-token') || '';
  if (token !== env.N8N_INGEST_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const payload = Array.isArray(body)
    ? { transactions: body }
    : Array.isArray(body?.transactions)
      ? body
      : { transactions: [body] };
  const parsed = financialTransactionsBatchSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const results = await upsertPlatformFinancialTransactions(parsed.data.transactions);
  return NextResponse.json({ ok: true, processed: results.length });
}

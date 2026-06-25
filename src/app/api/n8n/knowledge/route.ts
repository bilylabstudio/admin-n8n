import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import { getBotKnowledge } from '@/lib/bot-knowledge';

const knowledgeRequestSchema = z.object({
  external_message_id: z.string().optional().nullable(),
  customer_email: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  inbound_email: z.string().optional().nullable(),
  customer_name: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  current_message: z.string().optional().nullable(),
  order_number: z.string().optional().nullable(),
  received_at: z.string().optional().nullable(),
  reference_date: z.string().optional().nullable(),
  classification: z.record(z.unknown()).optional().nullable()
});

export async function POST(request: Request) {
  const token = request.headers.get('x-n8n-ingest-token') || '';
  if (token !== env.N8N_INGEST_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = knowledgeRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const knowledge = await getBotKnowledge(parsed.data);
  return NextResponse.json({ ok: true, knowledge });
}

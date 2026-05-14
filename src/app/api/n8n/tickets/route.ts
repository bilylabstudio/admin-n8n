import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { ingestTicket, ingestTicketSchema } from '@/lib/tickets';

export async function POST(request: Request) {
  const token = request.headers.get('x-n8n-ingest-token') || '';
  if (token !== env.N8N_INGEST_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = ingestTicketSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const ticket = await ingestTicket(parsed.data);

  return NextResponse.json({
    ok: true,
    ticket_id: ticket.id,
    status: ticket.status
  });
}

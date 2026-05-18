import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { formExpiryDate, generateFormToken } from '@/lib/forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  ticket_id: z.string().min(1).optional(),
  customer_email: z.string().email()
});

export async function POST(req: NextRequest) {
  const expected = env.N8N_FORMS_MINT_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'mint_token_not_configured' },
      { status: 503 }
    );
  }

  const provided = req.headers.get('x-review-admin-token')?.trim();
  if (!provided || provided !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const rawTicketId = body.ticket_id?.trim() || '';
  // Only treat as a real Ticket reference if it looks like a cuid AND exists in the DB.
  // The bot may pass a session_id (e.g. "email-foo-bar") which is not a Ticket FK.
  const cuidLike = /^c[a-z0-9]{20,}$/.test(rawTicketId);
  let ticketId: string | null = null;
  let sessionHint: string | null = null;
  if (cuidLike) {
    const ticketExists = await db.ticket.findUnique({ where: { id: rawTicketId }, select: { id: true } });
    if (ticketExists) ticketId = rawTicketId;
    else sessionHint = rawTicketId;
  } else if (rawTicketId) {
    sessionHint = rawTicketId;
  }

  // Idempotency: prefer ticket linkage when available, otherwise dedupe by customer email
  const existing = ticketId
    ? await db.formSubmission.findFirst({
        where: {
          ticketId,
          type: 'devolucion',
          status: 'pending',
          expiresAt: { gt: new Date() }
        }
      })
    : await db.formSubmission.findFirst({
        where: {
          customerEmail: body.customer_email.trim().toLowerCase(),
          type: 'devolucion',
          status: 'pending',
          expiresAt: { gt: new Date() }
        }
      });

  const form =
    existing ??
    (await db.formSubmission.create({
      data: {
        token: generateFormToken(),
        type: 'devolucion',
        ticketId,
        customerEmail: body.customer_email.trim().toLowerCase(),
        expiresAt: formExpiryDate()
      }
    }));

  if (!existing) {
    await db.auditEvent.create({
      data: {
        formId: form.id,
        eventType: 'form_minted',
        metadataJson: {
          ticket_id: ticketId,
          session_hint: sessionHint,
          customer_email: body.customer_email
        }
      }
    });
  }

  const baseUrl = (env.APP_BASE_URL ?? '').replace(/\/$/, '');
  const url = baseUrl ? `${baseUrl}/forms/devolucion/${form.token}` : `/forms/devolucion/${form.token}`;

  return NextResponse.json({
    ok: true,
    url,
    token: form.token,
    form_id: form.id,
    expires_at: form.expiresAt.toISOString(),
    reused: Boolean(existing)
  });
}

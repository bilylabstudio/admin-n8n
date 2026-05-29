import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type BulkDiscardPayload = {
  mode?: 'selected' | 'pending_review';
  ticket_ids?: unknown;
};

export async function POST(request: Request) {
  const user = await requireUser();

  let payload: BulkDiscardPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const mode = payload.mode === 'pending_review' ? 'pending_review' : 'selected';
  const ticketIds = Array.isArray(payload.ticket_ids)
    ? Array.from(
        new Set(
          payload.ticket_ids
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean)
        )
      )
    : [];

  if (mode === 'selected' && !ticketIds.length) {
    return NextResponse.json({ ok: false, error: 'missing_ticket_ids' }, { status: 400 });
  }

  const where: Prisma.TicketWhereInput =
    mode === 'pending_review'
      ? { status: 'pending_review' }
      : { id: { in: ticketIds }, status: 'pending_review' };

  const tickets = await db.ticket.findMany({
    where,
    select: { id: true, status: true }
  });

  if (!tickets.length) {
    return NextResponse.json({ ok: true, discarded: 0 });
  }

  const ids = tickets.map((ticket) => ticket.id);

  await db.$transaction([
    db.ticket.updateMany({
      where: { id: { in: ids }, status: 'pending_review' },
      data: { status: 'discarded' }
    }),
    db.auditEvent.createMany({
      data: tickets.map((ticket) => ({
        ticketId: ticket.id,
        userId: user.id,
        eventType: 'discarded',
        beforeStatus: ticket.status,
        afterStatus: 'discarded',
        metadataJson: {
          bulk: true,
          mode
        }
      }))
    })
  ]);

  return NextResponse.json({ ok: true, discarded: tickets.length });
}

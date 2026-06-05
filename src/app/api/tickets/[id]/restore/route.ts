import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { canRestoreToReview } from '@/lib/status';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const ticket = await db.ticket.findUnique({ where: { id: params.id } });

  if (!ticket) {
    return NextResponse.json({ ok: false, error: 'ticket_not_found' }, { status: 404 });
  }

  if (!canRestoreToReview(ticket.status)) {
    return NextResponse.json({ ok: false, error: 'ticket_not_discarded' }, { status: 409 });
  }

  await db.$transaction([
    db.ticket.update({
      where: { id: ticket.id },
      data: { status: 'pending_review' }
    }),
    db.auditEvent.create({
      data: {
        ticketId: ticket.id,
        userId: user.id,
        eventType: 'ticket_updated',
        beforeStatus: ticket.status,
        afterStatus: 'pending_review',
        metadataJson: {
          action: 'restored_to_review'
        }
      }
    })
  ]);

  return NextResponse.json({ ok: true, status: 'pending_review' });
}

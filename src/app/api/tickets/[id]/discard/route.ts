import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { canReview } from '@/lib/status';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const ticket = await db.ticket.findUnique({ where: { id: params.id } });

  if (!ticket || !canReview(ticket.status)) {
    return NextResponse.redirect(new URL(`/tickets/${params.id}?error=not_reviewable`, request.url), 303);
  }

  await db.ticket.update({ where: { id: ticket.id }, data: { status: 'discarded' } });
  await db.auditEvent.create({
    data: {
      ticketId: ticket.id,
      userId: user.id,
      eventType: 'discarded',
      beforeStatus: ticket.status,
      afterStatus: 'discarded'
    }
  });

  return NextResponse.redirect(new URL(`/tickets/${ticket.id}`, request.url), 303);
}

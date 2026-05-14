import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { redirectToApp } from '@/lib/redirects';
import { canReview } from '@/lib/status';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const ticket = await db.ticket.findUnique({ where: { id: params.id } });

  if (!ticket || !canReview(ticket.status)) {
    return redirectToApp(`/tickets/${params.id}?error=not_reviewable`);
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

  return redirectToApp(`/tickets/${ticket.id}`);
}

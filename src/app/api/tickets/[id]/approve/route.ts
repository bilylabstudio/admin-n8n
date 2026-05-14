import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sendApprovedReply } from '@/lib/n8n';
import { canReview } from '@/lib/status';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const ticket = await db.ticket.findUnique({ where: { id: params.id } });

  if (!ticket || !canReview(ticket.status)) {
    return NextResponse.redirect(new URL(`/tickets/${params.id}?error=not_reviewable`, request.url), 303);
  }

  const result = await sendApprovedReply({
    ticket_id: ticket.id,
    to_email: ticket.customerEmail,
    subject: ticket.subject,
    final_reply: ticket.aiReply,
    approved_by: user.email,
    approval_action: 'approved'
  });

  if (!result.ok) {
    await db.ticket.update({
      where: { id: ticket.id },
      data: { status: 'send_failed', sendError: result.message || result.error }
    });
    await db.auditEvent.create({
      data: {
        ticketId: ticket.id,
        userId: user.id,
        eventType: 'send_failed',
        beforeStatus: ticket.status,
        afterStatus: 'send_failed',
        metadataJson: result
      }
    });
    return NextResponse.redirect(new URL(`/tickets/${ticket.id}?error=send_failed`, request.url), 303);
  }

  await db.ticket.update({
    where: { id: ticket.id },
    data: {
      status: 'approved_sent',
      finalReply: ticket.aiReply,
      approvedByUserId: user.id,
      sentAt: result.sent_at ? new Date(result.sent_at) : new Date(),
      providerMessageId: result.provider_message_id,
      sendError: null
    }
  });

  await db.auditEvent.create({
    data: {
      ticketId: ticket.id,
      userId: user.id,
      eventType: 'approved_sent',
      beforeStatus: ticket.status,
      afterStatus: 'approved_sent',
      metadataJson: result
    }
  });

  return NextResponse.redirect(new URL(`/tickets/${ticket.id}`, request.url), 303);
}

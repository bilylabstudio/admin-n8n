import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sendApprovedReply } from '@/lib/n8n';
import { redirectToApp } from '@/lib/redirects';
import { canReview, isReplyEdited } from '@/lib/status';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const form = await request.formData();
  const finalReply = String(form.get('final_reply') || '').trim();
  const ticket = await db.ticket.findUnique({ where: { id: params.id } });

  if (!ticket || !canReview(ticket.status) || !finalReply) {
    return redirectToApp(`/tickets/${params.id}?error=invalid_reply`);
  }

  const edited = isReplyEdited(finalReply, ticket.aiReply);
  const nextStatus = edited ? 'edited_sent' : 'approved_sent';
  const approvalAction = edited ? 'edited' : 'approved';

  const result = await sendApprovedReply({
    ticket_id: ticket.id,
    to_email: ticket.customerEmail,
    subject: ticket.subject,
    final_reply: finalReply,
    approved_by: user.email,
    approval_action: approvalAction,
    in_reply_to_message_id: ticket.externalMessageId ?? undefined,
  });

  if (!result.ok) {
    await db.ticket.update({
      where: { id: ticket.id },
      data: { status: 'send_failed', finalReply, sendError: result.message || result.error }
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
    return redirectToApp(`/tickets/${ticket.id}?error=send_failed`);
  }

  await db.ticket.update({
    where: { id: ticket.id },
    data: {
      status: nextStatus,
      finalReply,
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
      eventType: nextStatus,
      beforeStatus: ticket.status,
      afterStatus: nextStatus,
      metadataJson: { ...result, edited }
    }
  });

  return redirectToApp(`/tickets/${ticket.id}`);
}

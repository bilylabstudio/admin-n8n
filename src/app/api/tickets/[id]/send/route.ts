import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { editIntensity } from '@/lib/dashboard-quality';
import { sendApprovedReply } from '@/lib/n8n';
import { redirectToApp } from '@/lib/redirects';
import { canReview, isReplyEdited } from '@/lib/status';
import { AttachmentSendError, loadStagedAttachmentsForSend, markAttachmentsSent } from '@/lib/ticket-attachments-send';
import {
  appendSentCopy,
  buildRfc822Message,
  markAnswered,
  type WebmailSyncResult
} from '@/lib/webmail-sync';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const form = await request.formData();
  const finalReply = String(form.get('final_reply') || '').trim();
  const attachmentIds = form.getAll('attachment_ids').map((value) => String(value)).filter(Boolean);
  const ticket = await db.ticket.findUnique({ where: { id: params.id } });

  if (!ticket || !canReview(ticket.status) || !finalReply) {
    return redirectToApp(`/tickets/${params.id}?error=invalid_reply`);
  }

  let stagedAttachments: Awaited<ReturnType<typeof loadStagedAttachmentsForSend>>;
  try {
    stagedAttachments = await loadStagedAttachmentsForSend(attachmentIds, [ticket.id]);
  } catch (err) {
    const code = err instanceof AttachmentSendError ? err.code : 'attachment_error';
    return redirectToApp(`/tickets/${params.id}?error=${code}`);
  }

  const edited = isReplyEdited(finalReply, ticket.aiReply);
  const nextStatus = edited ? 'edited_sent' : 'approved_sent';
  const approvalAction = edited ? 'edited' : 'approved';
  const editMetrics = {
    edited,
    edit_intensity: edited ? editIntensity(ticket.aiReply, finalReply) : 0,
    ai_reply_length: ticket.aiReply.trim().length,
    final_reply_length: finalReply.trim().length
  };

  const result = await sendApprovedReply({
    ticket_id: ticket.id,
    to_email: ticket.customerEmail,
    subject: ticket.subject,
    final_reply: finalReply,
    approved_by: user.email,
    approval_action: approvalAction,
    in_reply_to_message_id: ticket.messageId ?? ticket.externalMessageId ?? undefined,
    imap_uid: ticket.imapUid ?? undefined,
    imap_mailbox: ticket.imapMailbox ?? undefined,
    message_id: ticket.messageId ?? ticket.externalMessageId ?? undefined,
    references: ticket.references ?? undefined,
    ...(stagedAttachments.payload.length ? { attachments: stagedAttachments.payload } : {})
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
    // Leave staged attachments untouched so the retry flow doesn't force a re-upload.
    return redirectToApp(`/tickets/${ticket.id}?error=send_failed`);
  }

  const answeredSync = await markAnswered({
    uid: ticket.imapUid,
    mailbox: ticket.imapMailbox
  });

  let sentCopySync: WebmailSyncResult = {
    ok: true,
    skipped: true,
    action: 'append_sent',
    message: 'missing_sent_message'
  };

  if (result.sent_message) {
    // Trust only what n8n confirms it actually attached; fall back to
    // everything we sent if an older n8n workflow doesn't echo it back yet.
    const confirmedFilenames = result.sent_message.attachments?.map((item) => item.filename);
    const rfc822Attachments = stagedAttachments.payload
      .filter((item) => !confirmedFilenames || confirmedFilenames.includes(item.filename))
      .map((item) => ({ filename: item.filename, mimeType: item.mime_type, contentBase64: item.content_base64 }));

    const rfc822 = buildRfc822Message({
      from: result.sent_message.from,
      to: result.sent_message.to,
      subject: result.sent_message.subject,
      text: result.sent_message.text,
      html: result.sent_message.html,
      sentAt: result.sent_message.sent_at,
      inReplyTo: result.sent_message.in_reply_to,
      references: result.sent_message.references,
      attachments: rfc822Attachments
    });
    sentCopySync = await appendSentCopy({
      message: rfc822,
      sentAt: result.sent_message.sent_at
    });
  }

  const webmailSyncError = [answeredSync, sentCopySync]
    .filter((item) => !item.ok)
    .map((item) => `${item.action}:${item.message || 'failed'}`)
    .join('; ');
  const syncNow = new Date();
  const sentAt = result.sent_at ? new Date(result.sent_at) : new Date();

  await markAttachmentsSent(attachmentIds, { sentAt });

  await db.ticket.update({
    where: { id: ticket.id },
    data: {
      status: nextStatus,
      finalReply,
      approvedByUserId: user.id,
      sentAt,
      providerMessageId: result.provider_message_id,
      seenSyncedAt: answeredSync.ok && !answeredSync.skipped ? syncNow : ticket.seenSyncedAt,
      answeredSyncedAt:
        answeredSync.ok && !answeredSync.skipped ? syncNow : ticket.answeredSyncedAt,
      sentFolderSyncedAt:
        sentCopySync.ok && !sentCopySync.skipped ? syncNow : ticket.sentFolderSyncedAt,
      ...(result.sent_message ? { sentMessageJson: result.sent_message } : {}),
      webmailSyncError: webmailSyncError || null,
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
      metadataJson: {
        ...result,
        ...editMetrics,
        attachment_ids: attachmentIds,
        webmail_sync: {
          answered: answeredSync,
          sent_copy: sentCopySync
        }
      }
    }
  });

  return redirectToApp(`/tickets/${ticket.id}`);
}

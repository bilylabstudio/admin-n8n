import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { editIntensity } from '@/lib/dashboard-quality';
import { sendApprovedReply } from '@/lib/n8n';
import { AttachmentSendError, loadStagedAttachmentsForSend, markAttachmentsSent } from '@/lib/ticket-attachments-send';
import {
  appendSentCopy,
  buildRfc822Message,
  markAnswered,
  type WebmailSyncResult
} from '@/lib/webmail-sync';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: { email: string } }
) {
  const user = await requireUser();
  const email = decodeURIComponent(params.email);

  let payload: { final_reply?: string; ticket_id?: string; attachment_ids?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const finalReply = String(payload.final_reply || '').trim();
  if (!finalReply) {
    return NextResponse.json({ ok: false, error: 'empty_reply' }, { status: 400 });
  }
  const attachmentIds = Array.isArray(payload.attachment_ids)
    ? payload.attachment_ids.map((value) => String(value)).filter(Boolean)
    : [];

  const ticket = await db.ticket.findFirst({
    where: {
      customerEmail: email,
      ...(payload.ticket_id ? { id: payload.ticket_id } : {})
    },
    orderBy: { receivedAt: 'desc' }
  });

  if (!ticket) {
    return NextResponse.json({ ok: false, error: 'ticket_not_found' }, { status: 404 });
  }

  let stagedAttachments: Awaited<ReturnType<typeof loadStagedAttachmentsForSend>>;
  try {
    const customerTickets = await db.ticket.findMany({
      where: { customerEmail: email },
      select: { id: true }
    });
    stagedAttachments = await loadStagedAttachmentsForSend(
      attachmentIds,
      customerTickets.map((row) => row.id)
    );
  } catch (err) {
    const code = err instanceof AttachmentSendError ? err.code : 'attachment_error';
    return NextResponse.json({ ok: false, error: code }, { status: 400 });
  }

  const editMetrics = {
    edited: true,
    edit_intensity: editIntensity(ticket.aiReply, finalReply),
    ai_reply_length: ticket.aiReply.trim().length,
    final_reply_length: finalReply.trim().length
  };

  const result = await sendApprovedReply({
    ticket_id: ticket.id,
    to_email: ticket.customerEmail,
    subject: ticket.subject,
    final_reply: finalReply,
    approved_by: user.email,
    approval_action: 'edited',
    in_reply_to_message_id: ticket.messageId ?? ticket.externalMessageId ?? undefined,
    imap_uid: ticket.imapUid ?? undefined,
    imap_mailbox: ticket.imapMailbox ?? undefined,
    message_id: ticket.messageId ?? ticket.externalMessageId ?? undefined,
    references: ticket.references ?? undefined,
    ...(stagedAttachments.payload.length ? { attachments: stagedAttachments.payload } : {})
  });

  if (!result.ok) {
    await db.auditEvent.create({
      data: {
        ticketId: ticket.id,
        userId: user.id,
        eventType: 'ticket_updated',
        beforeStatus: ticket.status,
        afterStatus: ticket.status,
        metadataJson: {
          action: 'thread_follow_up_failed',
          result
        }
      }
    });

    // Leave staged attachments untouched so the retry flow doesn't force a re-upload.
    return NextResponse.json(
      { ok: false, error: result.error, message: result.message || 'No se pudo enviar.' },
      { status: 502 }
    );
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

  const sentAt = result.sent_at ? new Date(result.sent_at) : new Date();
  const syncNow = new Date();
  const webmailSyncError = [answeredSync].filter((item) => !item.ok).map((item) => `${item.action}:${item.message || 'failed'}`);

  const threadMessage = await db.threadMessage.create({
    data: {
      customerEmail: ticket.customerEmail,
      customerName: ticket.customerName,
      ticketId: ticket.id,
      direction: 'outbound',
      source: 'admin',
      subject: ticket.subject,
      text: finalReply,
      messageAt: sentAt,
      providerMessageId: result.provider_message_id,
      rawJson: { result }
    }
  });

  await markAttachmentsSent(attachmentIds, { sentAt, threadMessageId: threadMessage.id });

  if (result.sent_message) {
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

  webmailSyncError.push(
    ...[sentCopySync].filter((item) => !item.ok).map((item) => `${item.action}:${item.message || 'failed'}`)
  );

  await db.ticket.update({
    where: { id: ticket.id },
    data: {
      seenSyncedAt:
        answeredSync.ok && !answeredSync.skipped ? syncNow : ticket.seenSyncedAt,
      answeredSyncedAt:
        answeredSync.ok && !answeredSync.skipped ? syncNow : ticket.answeredSyncedAt,
      webmailSyncError: webmailSyncError.join('; ') || null
    }
  });

  await db.auditEvent.create({
    data: {
      ticketId: ticket.id,
      userId: user.id,
      eventType: 'ticket_updated',
      beforeStatus: ticket.status,
      afterStatus: ticket.status,
      metadataJson: {
        action: 'thread_follow_up_sent',
        thread_message_id: threadMessage.id,
        attachment_ids: attachmentIds,
        ...editMetrics,
        result,
        webmail_sync: {
          answered: answeredSync,
          sent_copy: sentCopySync
        }
      }
    }
  });

  return NextResponse.json({
    ok: true,
    threadMessageId: threadMessage.id,
    sentAt: sentAt.toISOString(),
    providerMessageId: result.provider_message_id || null,
    webmailSync: {
      answered: answeredSync,
      sentCopy: sentCopySync
    }
  });
}

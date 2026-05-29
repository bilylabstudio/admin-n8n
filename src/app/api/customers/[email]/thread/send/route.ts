import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sendApprovedReply } from '@/lib/n8n';
import {
  appendSentCopy,
  buildRfc822Message,
  type WebmailSyncResult
} from '@/lib/webmail-sync';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: { email: string } }
) {
  const user = await requireUser();
  const email = decodeURIComponent(params.email);

  let payload: { final_reply?: string; ticket_id?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const finalReply = String(payload.final_reply || '').trim();
  if (!finalReply) {
    return NextResponse.json({ ok: false, error: 'empty_reply' }, { status: 400 });
  }

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
    references: ticket.references ?? undefined
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

    return NextResponse.json(
      { ok: false, error: result.error, message: result.message || 'No se pudo enviar.' },
      { status: 502 }
    );
  }

  let sentCopySync: WebmailSyncResult = {
    ok: true,
    skipped: true,
    action: 'append_sent',
    message: 'missing_sent_message'
  };

  if (result.sent_message) {
    const rfc822 = buildRfc822Message({
      from: result.sent_message.from,
      to: result.sent_message.to,
      subject: result.sent_message.subject,
      text: result.sent_message.text,
      html: result.sent_message.html,
      sentAt: result.sent_message.sent_at,
      inReplyTo: result.sent_message.in_reply_to,
      references: result.sent_message.references
    });
    sentCopySync = await appendSentCopy({
      message: rfc822,
      sentAt: result.sent_message.sent_at
    });
  }

  const sentAt = result.sent_at ? new Date(result.sent_at) : new Date();
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
      rawJson: {
        result,
        webmail_sync: {
          sent_copy: sentCopySync
        }
      }
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
        result,
        webmail_sync: {
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
    webmailSync: sentCopySync
  });
}

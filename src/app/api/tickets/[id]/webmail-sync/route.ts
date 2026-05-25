import type { TicketStatus } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  appendSentCopy,
  buildRfc822Message,
  markAnswered,
  markSeen,
  type WebmailSyncResult
} from '@/lib/webmail-sync';

type SentMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  sent_at: string;
  in_reply_to?: string;
  references?: string;
};

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  const action = String(body.action || 'seen');

  const ticket = await db.ticket.findUnique({ where: { id: params.id } });
  if (!ticket) {
    return NextResponse.json({ ok: false, error: 'ticket_not_found' }, { status: 404 });
  }

  if (action === 'seen') {
    if (ticket.seenSyncedAt) {
      return NextResponse.json({ ok: true, skipped: true, action: 'seen' });
    }

    const result = await markSeen({ uid: ticket.imapUid, mailbox: ticket.imapMailbox });
    if (result.skipped) return NextResponse.json(result);

    await db.ticket.update({
      where: { id: ticket.id },
      data: result.ok
        ? { seenSyncedAt: new Date(), webmailSyncError: null }
        : { webmailSyncError: result.message || 'webmail_seen_failed' }
    });
    await auditWebmailSync(ticket.id, user.id, ticket.status, result);
    return NextResponse.json(result);
  }

  if (action === 'answered') {
    const result = await markAnswered({ uid: ticket.imapUid, mailbox: ticket.imapMailbox });
    if (result.skipped) return NextResponse.json(result);

    const now = new Date();
    await db.ticket.update({
      where: { id: ticket.id },
      data: result.ok
        ? {
            answeredSyncedAt: now,
            seenSyncedAt: ticket.seenSyncedAt || now,
            webmailSyncError: null
          }
        : { webmailSyncError: result.message || 'webmail_answered_failed' }
    });
    await auditWebmailSync(ticket.id, user.id, ticket.status, result);
    return NextResponse.json(result);
  }

  if (action === 'append_sent') {
    const sentMessage = normalizeSentMessage(ticket.sentMessageJson);
    if (!sentMessage) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        action: 'append_sent',
        message: 'missing_sent_message'
      });
    }

    const rfc822 = buildRfc822Message({
      from: sentMessage.from,
      to: sentMessage.to,
      subject: sentMessage.subject,
      text: sentMessage.text,
      html: sentMessage.html,
      sentAt: sentMessage.sent_at,
      inReplyTo: sentMessage.in_reply_to,
      references: sentMessage.references
    });
    const result = await appendSentCopy({ message: rfc822, sentAt: sentMessage.sent_at });
    if (result.skipped) return NextResponse.json(result);

    await db.ticket.update({
      where: { id: ticket.id },
      data: result.ok
        ? { sentFolderSyncedAt: new Date(), webmailSyncError: null }
        : { webmailSyncError: result.message || 'webmail_append_sent_failed' }
    });
    await auditWebmailSync(ticket.id, user.id, ticket.status, result);
    return NextResponse.json(result);
  }

  return NextResponse.json({ ok: false, error: 'invalid_webmail_sync_action' }, { status: 400 });
}

async function auditWebmailSync(
  ticketId: string,
  userId: string,
  status: TicketStatus,
  result: WebmailSyncResult
) {
  await db.auditEvent.create({
    data: {
      ticketId,
      userId,
      eventType: 'ticket_updated',
      beforeStatus: status,
      afterStatus: status,
      metadataJson: { webmail_sync: result }
    }
  });
}

function normalizeSentMessage(value: unknown): SentMessage | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const sentMessage = {
    from: String(item.from || ''),
    to: String(item.to || ''),
    subject: String(item.subject || ''),
    text: String(item.text || ''),
    html: String(item.html || ''),
    sent_at: String(item.sent_at || ''),
    in_reply_to: item.in_reply_to ? String(item.in_reply_to) : undefined,
    references: item.references ? String(item.references) : undefined
  };

  return sentMessage.from &&
    sentMessage.to &&
    sentMessage.subject &&
    sentMessage.text &&
    sentMessage.html &&
    sentMessage.sent_at
    ? sentMessage
    : null;
}

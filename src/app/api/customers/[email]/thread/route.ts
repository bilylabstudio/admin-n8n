import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { getCustomerProfile } from '@/lib/customer-profile';
import { db } from '@/lib/db';
import {
  dedupeThreadMessages,
  latestReviewableTicket,
  storedThreadMessageToView,
  ticketToThreadMessages
} from '@/lib/thread-messages';
import { fetchSentMessagesForCustomer } from '@/lib/webmail-thread';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

export async function GET(
  request: Request,
  { params }: { params: { email: string } }
) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  const url = new URL(request.url);
  const email = decodeURIComponent(params.email);
  const selectedTicketId = url.searchParams.get('ticketId');
  const limit = clampLimit(Number(url.searchParams.get('limit') || DEFAULT_LIMIT));

  const [selectedTicket, recentTickets] = await Promise.all([
    selectedTicketId
      ? db.ticket.findFirst({
          where: { id: selectedTicketId, customerEmail: email }
        })
      : null,
    db.ticket.findMany({
      where: { customerEmail: email },
      orderBy: { receivedAt: 'desc' },
      take: limit
    })
  ]);

  const ticketMap = new Map(recentTickets.map((ticket) => [ticket.id, ticket]));
  if (selectedTicket) ticketMap.set(selectedTicket.id, selectedTicket);
  const tickets = Array.from(ticketMap.values());
  const customerProfile = await getCustomerProfile({
    email,
    texts: tickets.flatMap((ticket) => [ticket.subject, ticket.originalText])
  });

  const sentMessages = await withTimeout(fetchSentMessagesForCustomer(email, limit), 2500);
  if (sentMessages.length) {
    await Promise.all(
      sentMessages.map((message) =>
        db.threadMessage.upsert({
          where: {
            imapMailbox_imapUid: {
              imapMailbox: message.imapMailbox,
              imapUid: message.imapUid
            }
          },
          create: {
            customerEmail: message.customerEmail,
            customerName: message.customerName,
            direction: 'outbound',
            source: 'webmail',
            subject: message.subject,
            text: message.text,
            messageAt: message.messageAt,
            messageId: message.messageId,
            imapUid: message.imapUid,
            imapMailbox: message.imapMailbox,
            rawJson: message.rawJson as Prisma.InputJsonValue
          },
          update: {
            subject: message.subject,
            text: message.text,
            messageAt: message.messageAt,
            messageId: message.messageId,
            rawJson: message.rawJson as Prisma.InputJsonValue
          }
        })
      )
    );
  }

  const storedMessages = await db.threadMessage.findMany({
    where: { customerEmail: email },
    orderBy: { messageAt: 'desc' },
    take: limit
  });

  const messages = dedupeThreadMessages([
    ...tickets.flatMap(ticketToThreadMessages),
    ...storedMessages.map(storedThreadMessageToView)
  ]).slice(-limit);

  const latest = messages[messages.length - 1] || null;
  const pendingTicket = latestReviewableTicket(tickets, selectedTicketId);
  const shouldReviewTicket =
    pendingTicket && latest?.direction === 'inbound' && latest.ticketId === pendingTicket.id;

  const anchorTicket = selectedTicket || tickets[0] || null;

  return NextResponse.json({
    ok: true,
    customerEmail: email,
    customerName: anchorTicket?.customerName || storedMessages[0]?.customerName || null,
    customerProfile,
    subject: anchorTicket?.subject || storedMessages[0]?.subject || '(sin asunto)',
    anchorTicketId: anchorTicket?.id || null,
    pendingTicketId: shouldReviewTicket ? pendingTicket.id : null,
    composerMode: shouldReviewTicket ? 'review_ticket' : 'follow_up',
    draft: shouldReviewTicket ? pendingTicket.finalReply || pendingTicket.aiReply || '' : '',
    messages
  });
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | []> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<[]>((resolve) => {
        timer = setTimeout(() => resolve([]), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

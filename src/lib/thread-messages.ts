import type { ThreadMessage, Ticket } from '@prisma/client';
import { canReview } from './status';
import { getTicketTags } from './ticket-tags';

const SENT_STATUSES = new Set(['approved_sent', 'edited_sent']);

export type ThreadMessageView = {
  id: string;
  ticketId: string | null;
  direction: 'inbound' | 'outbound';
  source: 'admin' | 'webmail';
  subject: string;
  text: string;
  at: string;
  status: Ticket['status'] | null;
  customerName: string | null;
  tags: ReturnType<typeof getTicketTags>;
};

export type ThreadTicket = Ticket;

export function ticketToThreadMessages(ticket: ThreadTicket): ThreadMessageView[] {
  const messages: ThreadMessageView[] = [
    {
      id: `ticket:${ticket.id}:inbound`,
      ticketId: ticket.id,
      direction: 'inbound',
      source: 'webmail',
      subject: ticket.subject,
      text: ticket.originalText,
      at: ticket.receivedAt.toISOString(),
      status: ticket.status,
      customerName: ticket.customerName,
      tags: getTicketTags(ticket)
    }
  ];

  if (SENT_STATUSES.has(ticket.status)) {
    messages.push({
      id: `ticket:${ticket.id}:outbound`,
      ticketId: ticket.id,
      direction: 'outbound',
      source: 'admin',
      subject: ticket.subject,
      text: ticket.finalReply || ticket.aiReply || '',
      at: (ticket.sentAt || ticket.updatedAt).toISOString(),
      status: ticket.status,
      customerName: ticket.customerName,
      tags: []
    });
  }

  return messages;
}

export function storedThreadMessageToView(message: ThreadMessage): ThreadMessageView {
  return {
    id: `thread:${message.id}`,
    ticketId: message.ticketId,
    direction: message.direction,
    source: message.source,
    subject: message.subject,
    text: message.text,
    at: message.messageAt.toISOString(),
    status: null,
    customerName: message.customerName,
    tags: []
  };
}

export function latestReviewableTicket(tickets: ThreadTicket[], selectedTicketId?: string | null) {
  const selected = selectedTicketId
    ? tickets.find((ticket) => ticket.id === selectedTicketId && canReview(ticket.status))
    : null;
  if (selected) return selected;

  return [...tickets]
    .filter((ticket) => canReview(ticket.status))
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0] || null;
}

export function sortThreadMessages(messages: ThreadMessageView[]) {
  return [...messages].sort((a, b) => {
    const byDate = new Date(a.at).getTime() - new Date(b.at).getTime();
    if (byDate !== 0) return byDate;
    if (a.direction === b.direction) return a.id.localeCompare(b.id);
    return a.direction === 'inbound' ? -1 : 1;
  });
}

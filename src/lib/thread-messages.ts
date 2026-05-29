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

export function dedupeThreadMessages(messages: ThreadMessageView[]) {
  return sortThreadMessages(messages).reduce<ThreadMessageView[]>((result, message) => {
    if (message.direction !== 'outbound') {
      result.push(message);
      return result;
    }

    const duplicateIndex = result.findIndex((existing) =>
      isSameOutboundMessage(existing, message)
    );
    if (duplicateIndex === -1) {
      result.push(message);
      return result;
    }

    const existing = result[duplicateIndex];
    if (shouldPreferMessage(message, existing)) {
      result[duplicateIndex] = message;
    }
    return result;
  }, []);
}

function isSameOutboundMessage(a: ThreadMessageView, b: ThreadMessageView) {
  if (a.direction !== 'outbound' || b.direction !== 'outbound') return false;

  const aText = normalizeForCompare(a.text);
  const bText = normalizeForCompare(b.text);
  if (!aText || !bText) return false;

  const minutesApart = Math.abs(new Date(a.at).getTime() - new Date(b.at).getTime()) / 60_000;
  const sameSubject = normalizeForCompare(a.subject) === normalizeForCompare(b.subject);
  const sameText = hasMeaningfulOverlap(aText, bText);

  return sameText || (sameSubject && minutesApart <= 5 && startsSimilarly(aText, bText));
}

function shouldPreferMessage(candidate: ThreadMessageView, current: ThreadMessageView) {
  if (current.source === 'webmail' && candidate.source === 'admin') return true;
  if (current.status === null && candidate.status !== null) return true;
  return false;
}

function hasMeaningfulOverlap(a: string, b: string) {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length < 80) return false;
  return longer.includes(shorter.slice(0, Math.min(shorter.length, 220)));
}

function startsSimilarly(a: string, b: string) {
  const length = Math.min(a.length, b.length, 120);
  if (length < 40) return false;
  return a.slice(0, length) === b.slice(0, length);
}

function normalizeForCompare(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .toLowerCase();
}

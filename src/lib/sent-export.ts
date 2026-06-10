import type { TicketStatus } from '@prisma/client';

export const SENT_EXPORT_STATUSES = [
  'approved_sent',
  'edited_sent'
] as const satisfies readonly TicketStatus[];

export type SentExportTicket = {
  id: string;
  customerName: string | null;
  customerEmail: string;
  subject: string;
  receivedAt: Date;
  sentAt: Date | null;
  status: TicketStatus;
  originalText: string;
  aiReply: string;
  finalReply: string | null;
  updatedAt: Date;
};

export type SentExportMessage = {
  id: string;
  customerName: string | null;
  customerEmail: string;
  subject: string;
  receivedAt: string;
  sentAt: string | null;
  status: TicketStatus;
  wasEditedAndSent: boolean;
  originalMessage: string;
  aiMessage: string;
  sentMessage: string;
};

export type SentExportPayload = {
  exportedAt: string;
  scope: 'all_sent';
  count: number;
  messages: SentExportMessage[];
};

export function toSentExportMessage(ticket: SentExportTicket): SentExportMessage {
  return {
    id: ticket.id,
    customerName: ticket.customerName,
    customerEmail: ticket.customerEmail,
    subject: ticket.subject,
    receivedAt: ticket.receivedAt.toISOString(),
    sentAt: ticket.sentAt?.toISOString() || null,
    status: ticket.status,
    wasEditedAndSent: ticket.status === 'edited_sent',
    originalMessage: ticket.originalText,
    aiMessage: ticket.aiReply,
    sentMessage: ticket.finalReply || ticket.aiReply || ''
  };
}

export function buildSentExportPayload(
  tickets: SentExportTicket[],
  exportedAt: Date = new Date()
): SentExportPayload {
  return {
    exportedAt: exportedAt.toISOString(),
    scope: 'all_sent',
    count: tickets.length,
    messages: tickets.map(toSentExportMessage)
  };
}

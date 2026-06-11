import type { TicketStatus } from '@prisma/client';

export const SENT_EXPORT_STATUSES = [
  'approved_sent',
  'edited_sent'
] as const satisfies readonly TicketStatus[];

export type SentExportTicket = {
  originalText: string;
  aiReply: string;
  finalReply: string | null;
};

export type SentExportMessage = {
  originalMessage: string;
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
    originalMessage: ticket.originalText,
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

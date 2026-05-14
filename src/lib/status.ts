import type { TicketStatus } from '@prisma/client';

export const terminalStatuses: TicketStatus[] = [
  'approved_sent',
  'edited_sent',
  'discarded',
  'manual'
];

export function canUpdateFromIngest(status: TicketStatus): boolean {
  return !terminalStatuses.includes(status);
}

export function canReview(status: TicketStatus): boolean {
  return ['new', 'ai_generated', 'pending_review', 'send_failed'].includes(status);
}

export function nextStatusAfterIngest(hasAiReply: boolean): TicketStatus {
  return hasAiReply ? 'pending_review' : 'new';
}

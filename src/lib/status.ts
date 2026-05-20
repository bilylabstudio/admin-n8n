import type { TicketStatus } from '@prisma/client';

export type InboxGroup =
  | 'pending_review'
  | 'send_failed'
  | 'new'
  | 'ai_generated'
  | 'sent'
  | 'manual'
  | 'discarded';

export const terminalStatuses: TicketStatus[] = [
  'approved_sent',
  'edited_sent',
  'discarded',
  'manual'
];

export const inboxGroups: { id: InboxGroup; label: string; statuses: TicketStatus[] }[] = [
  { id: 'pending_review', label: 'Por revisar', statuses: ['pending_review'] },
  { id: 'send_failed', label: 'Error de envio', statuses: ['send_failed'] },
  { id: 'new', label: 'Sin respuesta IA', statuses: ['new'] },
  { id: 'ai_generated', label: 'Generado por IA', statuses: ['ai_generated'] },
  { id: 'sent', label: 'Enviados', statuses: ['approved_sent', 'edited_sent'] },
  { id: 'manual', label: 'Manual', statuses: ['manual'] },
  { id: 'discarded', label: 'Descartados', statuses: ['discarded'] }
];

export const statusLabels: Record<TicketStatus, string> = {
  new: 'Sin respuesta IA',
  ai_generated: 'Generado por IA',
  pending_review: 'Por revisar',
  approved_sent: 'Enviado sin cambios',
  edited_sent: 'Editado y enviado',
  discarded: 'Descartado',
  manual: 'Manual',
  send_failed: 'Error de envio'
};

export const statusTone: Record<TicketStatus, 'pending' | 'error' | 'neutral' | 'success' | 'manual' | 'muted'> = {
  new: 'neutral',
  ai_generated: 'neutral',
  pending_review: 'pending',
  approved_sent: 'success',
  edited_sent: 'success',
  discarded: 'muted',
  manual: 'manual',
  send_failed: 'error'
};

export function canUpdateFromIngest(status: TicketStatus): boolean {
  return !terminalStatuses.includes(status);
}

export function canReview(status: TicketStatus): boolean {
  return ['new', 'ai_generated', 'pending_review', 'send_failed'].includes(status);
}

export function nextStatusAfterIngest(hasAiReply: boolean): TicketStatus {
  return hasAiReply ? 'pending_review' : 'new';
}

export function isInboxGroup(value: string): value is InboxGroup {
  return inboxGroups.some((group) => group.id === value);
}

export function statusesForGroup(group: InboxGroup): TicketStatus[] {
  return inboxGroups.find((item) => item.id === group)?.statuses || ['pending_review'];
}

export function labelForStatus(status: TicketStatus): string {
  return statusLabels[status];
}

export function normalizeReply(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function isReplyEdited(draft: string, original: string | null | undefined): boolean {
  return normalizeReply(draft) !== normalizeReply(original ?? '');
}

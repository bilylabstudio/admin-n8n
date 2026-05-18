import { randomBytes } from 'crypto';
import type { FormStatus } from '@prisma/client';

export const FORM_TOKEN_LENGTH_BYTES = 16;
export const FORM_TOKEN_TTL_DAYS = 30;

export function generateFormToken(): string {
  return randomBytes(FORM_TOKEN_LENGTH_BYTES).toString('hex');
}

export function formExpiryDate(now: Date = new Date()): Date {
  return new Date(now.getTime() + FORM_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export type FormTokenValidity =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'already_submitted' };

export function isFormTokenValid(form: {
  expiresAt: Date;
  status: FormStatus;
}): FormTokenValidity {
  if (form.expiresAt < new Date()) return { ok: false, reason: 'expired' };
  if (form.status !== 'pending') return { ok: false, reason: 'already_submitted' };
  return { ok: true };
}

export const FORM_STATUS_TRANSITIONS: Record<FormStatus, FormStatus[]> = {
  pending: ['submitted'],
  submitted: ['approved_sent', 'rejected_sent', 'manual', 'discarded'],
  approved_sent: [],
  rejected_sent: [],
  manual: [],
  discarded: []
};

export function canTransition(from: FormStatus, to: FormStatus): boolean {
  return FORM_STATUS_TRANSITIONS[from].includes(to);
}

export function labelForFormStatus(status: FormStatus): string {
  switch (status) {
    case 'pending':
      return 'Pendiente envío';
    case 'submitted':
      return 'Por revisar';
    case 'approved_sent':
      return 'Aprobado';
    case 'rejected_sent':
      return 'Rechazado';
    case 'manual':
      return 'Manual';
    case 'discarded':
      return 'Descartado';
  }
}

export type FormInboxGroup =
  | 'submitted'
  | 'approved_sent'
  | 'rejected_sent'
  | 'manual'
  | 'discarded';

export const formInboxGroups: { id: FormInboxGroup; label: string }[] = [
  { id: 'submitted', label: 'Pendientes' },
  { id: 'approved_sent', label: 'Aprobados' },
  { id: 'rejected_sent', label: 'Rechazados' },
  { id: 'manual', label: 'Manual' },
  { id: 'discarded', label: 'Descartados' }
];

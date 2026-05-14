import { describe, expect, it } from 'vitest';
import {
  canReview,
  canUpdateFromIngest,
  isInboxGroup,
  labelForStatus,
  nextStatusAfterIngest,
  statusesForGroup,
  statusTone
} from './status';

describe('ticket status helpers', () => {
  it('allows ingest updates before terminal states', () => {
    expect(canUpdateFromIngest('pending_review')).toBe(true);
    expect(canUpdateFromIngest('send_failed')).toBe(true);
  });

  it('blocks ingest updates after terminal states', () => {
    expect(canUpdateFromIngest('approved_sent')).toBe(false);
    expect(canUpdateFromIngest('edited_sent')).toBe(false);
    expect(canUpdateFromIngest('discarded')).toBe(false);
    expect(canUpdateFromIngest('manual')).toBe(false);
  });

  it('maps ingest payloads to the correct initial status', () => {
    expect(nextStatusAfterIngest(true)).toBe('pending_review');
    expect(nextStatusAfterIngest(false)).toBe('new');
  });

  it('allows review for pending and failed tickets only', () => {
    expect(canReview('pending_review')).toBe(true);
    expect(canReview('send_failed')).toBe(true);
    expect(canReview('approved_sent')).toBe(false);
  });

  it('labels technical statuses in Spanish', () => {
    expect(labelForStatus('pending_review')).toBe('Por revisar');
    expect(labelForStatus('edited_sent')).toBe('Editado y enviado');
    expect(statusTone.send_failed).toBe('error');
  });

  it('groups sent statuses for the inbox rail', () => {
    expect(isInboxGroup('sent')).toBe(true);
    expect(isInboxGroup('approved_sent')).toBe(false);
    expect(statusesForGroup('sent')).toEqual(['approved_sent', 'edited_sent']);
  });
});

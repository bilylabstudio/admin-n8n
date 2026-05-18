import { describe, it, expect } from 'vitest';
import {
  canTransition,
  formExpiryDate,
  FORM_TOKEN_TTL_DAYS,
  generateFormToken,
  isFormTokenValid
} from './forms';

describe('generateFormToken', () => {
  it('returns 32 hex chars', () => {
    expect(generateFormToken()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns distinct tokens', () => {
    const a = generateFormToken();
    const b = generateFormToken();
    expect(a).not.toBe(b);
  });
});

describe('formExpiryDate', () => {
  it('returns 30 days from now', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const exp = formExpiryDate(now);
    expect(exp.getTime() - now.getTime()).toBe(FORM_TOKEN_TTL_DAYS * 86_400_000);
  });
});

describe('isFormTokenValid', () => {
  it('rejects expired tokens', () => {
    const result = isFormTokenValid({ expiresAt: new Date(0), status: 'pending' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('rejects already-submitted forms', () => {
    const result = isFormTokenValid({
      expiresAt: new Date(Date.now() + 1_000_000),
      status: 'submitted'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_submitted');
  });

  it('accepts valid tokens', () => {
    const result = isFormTokenValid({
      expiresAt: new Date(Date.now() + 1_000_000),
      status: 'pending'
    });
    expect(result.ok).toBe(true);
  });
});

describe('canTransition', () => {
  it('allows pending -> submitted', () => {
    expect(canTransition('pending', 'submitted')).toBe(true);
  });

  it('rejects submitted -> pending', () => {
    expect(canTransition('submitted', 'pending')).toBe(false);
  });

  it('rejects pending -> approved_sent', () => {
    expect(canTransition('pending', 'approved_sent')).toBe(false);
  });

  it('allows submitted -> approved_sent', () => {
    expect(canTransition('submitted', 'approved_sent')).toBe(true);
  });

  it('rejects transitions from terminal states', () => {
    expect(canTransition('approved_sent', 'rejected_sent')).toBe(false);
    expect(canTransition('discarded', 'submitted')).toBe(false);
    expect(canTransition('manual', 'approved_sent')).toBe(false);
  });
});

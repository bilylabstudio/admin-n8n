import { describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({
  env: {
    APP_SESSION_SECRET: 'test_session_secret_12345678901234567890',
    ADMIN_EMAILS: 'admin@example.com'
  },
  adminEmailSet: () => new Set(['admin@example.com'])
}));

import { hashPassword, hashToken, verifyPassword } from './auth';

describe('auth helpers', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('secret-password', 'fixedsalt');
    expect(verifyPassword('secret-password', stored)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const stored = hashPassword('secret-password', 'fixedsalt');
    expect(verifyPassword('wrong-password', stored)).toBe(false);
  });

  it('hashes session tokens consistently', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('def'));
  });
});

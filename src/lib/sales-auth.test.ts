import { describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({ salesHash: '' }));

vi.mock('./env', () => ({
  env: {
    APP_SESSION_SECRET: 'test_session_secret_12345678901234567890',
    ADMIN_EMAILS: 'admin@example.com',
    get SALES_AREA_PASSWORD_HASH() {
      return envState.salesHash;
    }
  },
  adminEmailSet: () => new Set(['admin@example.com'])
}));

import { hashPassword } from './auth';
import {
  createSalesSessionToken,
  verifySalesAreaPassword,
  verifySalesSessionToken
} from './sales-auth';

describe('sales auth helpers', () => {
  it('verifies the configured sales password', () => {
    envState.salesHash = hashPassword('ventas-secret', 'fixedsalt');

    expect(verifySalesAreaPassword('ventas-secret')).toBe(true);
    expect(verifySalesAreaPassword('wrong-password')).toBe(false);
  });

  it('rejects sales password checks when no hash is configured', () => {
    envState.salesHash = '';

    expect(verifySalesAreaPassword('ventas-secret')).toBe(false);
  });

  it('ties the sales session token to user, expiration, and current password hash', () => {
    envState.salesHash = hashPassword('ventas-secret', 'fixedsalt');
    const token = createSalesSessionToken('user-1', 1_000);

    expect(verifySalesSessionToken(token, 'user-1', 2_000)).toBe(true);
    expect(verifySalesSessionToken(token, 'user-2', 2_000)).toBe(false);
    expect(verifySalesSessionToken(token, 'user-1', 13 * 60 * 60 * 1_000)).toBe(false);

    envState.salesHash = hashPassword('new-ventas-secret', 'fixedsalt2');
    expect(verifySalesSessionToken(token, 'user-1', 2_000)).toBe(false);
  });
});

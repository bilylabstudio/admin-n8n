import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser, verifyPassword } from './auth';
import { env } from './env';

const SALES_SESSION_COOKIE = 'review_admin_sales_session';
const SALES_SESSION_SECONDS = 12 * 60 * 60;
const TOKEN_VERSION = 1;

type SalesSessionPayload = {
  v: typeof TOKEN_VERSION;
  userId: string;
  exp: number;
  fp: string;
  nonce: string;
};

export function salesAreaPasswordConfigured(): boolean {
  return Boolean(env.SALES_AREA_PASSWORD_HASH?.trim());
}

export function verifySalesAreaPassword(password: string): boolean {
  const stored = env.SALES_AREA_PASSWORD_HASH?.trim();
  if (!stored) return false;

  try {
    return verifyPassword(password, stored);
  } catch {
    return false;
  }
}

export function createSalesSessionToken(userId: string, now = Date.now()): string {
  const stored = env.SALES_AREA_PASSWORD_HASH?.trim();
  if (!stored) {
    throw new Error('SALES_AREA_PASSWORD_HASH is not configured.');
  }

  const payload: SalesSessionPayload = {
    v: TOKEN_VERSION,
    userId,
    exp: now + SALES_SESSION_SECONDS * 1000,
    fp: passwordFingerprint(stored),
    nonce: crypto.randomBytes(16).toString('base64url')
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySalesSessionToken(rawToken: string, userId: string, now = Date.now()): boolean {
  const stored = env.SALES_AREA_PASSWORD_HASH?.trim();
  if (!stored || !rawToken) return false;

  const [body, signature] = rawToken.split('.');
  if (!body || !signature || !safeEqualHex(signature, sign(body))) return false;

  const payload = decodePayload(body);
  if (!payload) return false;

  return (
    payload.v === TOKEN_VERSION &&
    payload.userId === userId &&
    payload.exp > now &&
    payload.fp === passwordFingerprint(stored)
  );
}

export function setSalesSessionCookie(userId: string): void {
  cookies().set(SALES_SESSION_COOKIE, createSalesSessionToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SALES_SESSION_SECONDS
  });
}

export function clearSalesSessionCookie(): void {
  cookies().delete(SALES_SESSION_COOKIE);
}

export function hasSalesSessionForUser(userId: string): boolean {
  const token = cookies().get(SALES_SESSION_COOKIE)?.value || '';
  return verifySalesSessionToken(token, userId);
}

export async function requireSalesAccess() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!hasSalesSessionForUser(user.id)) redirect('/ventas/login');
  return user;
}

export async function requireSalesApiAccess(): Promise<Response | null> {
  const user = await currentUser();
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!hasSalesSessionForUser(user.id)) {
    return Response.json({ ok: false, error: 'sales_area_locked' }, { status: 403 });
  }
  return null;
}

function passwordFingerprint(passwordHash: string): string {
  return crypto.createHmac('sha256', env.APP_SESSION_SECRET).update(passwordHash).digest('hex');
}

function sign(body: string): string {
  return crypto.createHmac('sha256', env.APP_SESSION_SECRET).update(body).digest('hex');
}

function decodePayload(body: string): SalesSessionPayload | null {
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<SalesSessionPayload>;
    if (
      value.v !== TOKEN_VERSION ||
      typeof value.userId !== 'string' ||
      typeof value.exp !== 'number' ||
      typeof value.fp !== 'string' ||
      typeof value.nonce !== 'string'
    ) {
      return null;
    }
    return value as SalesSessionPayload;
  } catch {
    return null;
  }
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

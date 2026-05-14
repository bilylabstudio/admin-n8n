import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from './db';
import { adminEmailSet, env } from './env';

const SESSION_COOKIE = 'review_admin_session';
const SESSION_DAYS = 7;

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')): string {
  const hash = crypto.pbkdf2Sync(password, salt, 210_000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) return false;
  const candidate = hashPassword(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expectedHash, 'hex'));
}

export function hashToken(token: string): string {
  return crypto.createHmac('sha256', env.APP_SESSION_SECRET).update(token).digest('hex');
}

export function createRawSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export async function createSession(userId: string): Promise<string> {
  const rawToken = createRawSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt
    }
  });

  return rawToken;
}

export function setSessionCookie(rawToken: string): void {
  cookies().set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60
  });
}

export function clearSessionCookie(): void {
  cookies().delete(SESSION_COOKIE);
}

export async function currentUser() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  });

  if (!session || session.expiresAt <= new Date()) return null;
  return session.user;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export function assertAllowedAdminEmail(email: string): void {
  if (!adminEmailSet().has(email.trim().toLowerCase())) {
    throw new Error('Email is not listed in ADMIN_EMAILS.');
  }
}

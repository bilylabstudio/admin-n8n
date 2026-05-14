import { NextResponse } from 'next/server';
import { writeAuditEvent } from '@/lib/audit';
import { createSession, setSessionCookie, verifyPassword } from '@/lib/auth';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');

  const user = await db.user.findUnique({ where: { email } });
  const baseUrl = env.APP_BASE_URL || new URL(request.url).origin;
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.redirect(new URL('/login?error=1', baseUrl), 303);
  }

  const token = await createSession(user.id);
  setSessionCookie(token);

  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

  await writeAuditEvent({
    userId: user.id,
    eventType: 'login',
    metadata: { email: user.email }
  });

  return NextResponse.redirect(new URL('/', baseUrl), 303);
}

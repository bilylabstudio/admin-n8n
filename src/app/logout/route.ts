import { NextResponse } from 'next/server';
import { writeAuditEvent } from '@/lib/audit';
import { clearSessionCookie, currentUser } from '@/lib/auth';
import { env } from '@/lib/env';

export async function GET(request: Request) {
  const user = await currentUser();
  clearSessionCookie();

  if (user) {
    await writeAuditEvent({
      userId: user.id,
      eventType: 'logout',
      metadata: { email: user.email }
    });
  }

  const baseUrl = env.APP_BASE_URL || new URL(request.url).origin;
  return NextResponse.redirect(new URL('/login', baseUrl));
}

import { NextResponse } from 'next/server';
import { writeAuditEvent } from '@/lib/audit';
import { clearSessionCookie, currentUser } from '@/lib/auth';

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

  return NextResponse.redirect(new URL('/login', request.url));
}

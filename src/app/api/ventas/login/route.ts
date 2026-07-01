import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { env } from '@/lib/env';
import { setSalesSessionCookie, verifySalesAreaPassword } from '@/lib/sales-auth';

export async function POST(request: Request) {
  const baseUrl = env.APP_BASE_URL || new URL(request.url).origin;
  const user = await currentUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', baseUrl), 303);
  }

  const form = await request.formData();
  const password = String(form.get('password') || '');
  if (!verifySalesAreaPassword(password)) {
    return NextResponse.redirect(new URL('/ventas/login?error=1', baseUrl), 303);
  }

  setSalesSessionCookie(user.id);
  return NextResponse.redirect(new URL('/ventas', baseUrl), 303);
}

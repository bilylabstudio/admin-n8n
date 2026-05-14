import { NextResponse } from 'next/server';
import { env } from './env';

export function appUrl(path: string): URL {
  return new URL(path, env.APP_BASE_URL || 'http://localhost:3000');
}

export function redirectToApp(path: string, status = 303): NextResponse {
  return NextResponse.redirect(appUrl(path), status);
}

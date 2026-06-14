import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 'authorization_failed',
        error,
        message: errorDescription || 'TikTok Shop rechazo o no completo la autorizacion.'
      },
      { status: 400 }
    );
  }

  if (!code) {
    return NextResponse.json(
      {
        ok: false,
        status: 'missing_code',
        hasCode: false,
        state,
        message: 'No se recibio codigo de autorizacion de TikTok Shop.'
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    status: 'authorization_code_received',
    hasCode: true,
    state,
    message: 'Codigo de autorizacion de TikTok Shop recibido. Completa el intercambio de tokens en n8n/settings.'
  });
}

import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/tiktok/callback', () => {
  it('confirms a received authorization code without exposing token material', async () => {
    const response = await GET(
      new Request('https://admin.example.com/api/tiktok/callback?code=fake-code&state=state-123')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      status: 'authorization_code_received',
      hasCode: true,
      state: 'state-123',
      message: 'Codigo de autorizacion de TikTok Shop recibido. Completa el intercambio de tokens en n8n/settings.'
    });
    expect(JSON.stringify(body)).not.toContain('fake-code');
    expect(JSON.stringify(body)).not.toContain('access_token');
    expect(JSON.stringify(body)).not.toContain('refresh_token');
  });

  it('returns a controlled error when TikTok sends an authorization error', async () => {
    const response = await GET(
      new Request(
        'https://admin.example.com/api/tiktok/callback?error=access_denied&error_description=Denied'
      )
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      status: 'authorization_failed',
      error: 'access_denied',
      message: 'Denied'
    });
  });

  it('rejects callbacks without code or error', async () => {
    const response = await GET(new Request('https://admin.example.com/api/tiktok/callback?state=abc'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      status: 'missing_code',
      hasCode: false,
      state: 'abc',
      message: 'No se recibio codigo de autorizacion de TikTok Shop.'
    });
  });
});

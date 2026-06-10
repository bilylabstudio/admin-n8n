import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  ticketFindMany: vi.fn()
}));

vi.mock('@/lib/auth', () => ({
  currentUser: mocks.currentUser
}));

vi.mock('@/lib/db', () => ({
  db: {
    ticket: {
      findMany: mocks.ticketFindMany
    }
  }
}));

import { GET } from './route';

describe('GET /api/tickets/export/sent', () => {
  beforeEach(() => {
    mocks.currentUser.mockReset();
    mocks.ticketFindMany.mockReset();
  });

  it('rejects unauthenticated users', async () => {
    mocks.currentUser.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, error: 'No autorizado' });
    expect(mocks.ticketFindMany).not.toHaveBeenCalled();
  });

  it('returns every sent ticket as export JSON', async () => {
    mocks.currentUser.mockResolvedValue({ id: 'user-1', email: 'admin@example.com' });
    mocks.ticketFindMany.mockResolvedValue([
      {
        id: 'ticket-1',
        customerName: 'Maria Cliente',
        customerEmail: 'maria@example.com',
        subject: 'Consulta pedido',
        receivedAt: new Date('2026-06-01T09:15:00.000Z'),
        sentAt: new Date('2026-06-01T09:45:00.000Z'),
        status: 'edited_sent',
        originalText: 'Mensaje original del cliente',
        aiReply: 'Respuesta IA',
        finalReply: 'Respuesta enviada editada',
        updatedAt: new Date('2026-06-01T09:45:30.000Z')
      }
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.ticketFindMany).toHaveBeenCalledWith({
      where: { status: { in: ['approved_sent', 'edited_sent'] } },
      orderBy: [{ sentAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        customerName: true,
        customerEmail: true,
        subject: true,
        receivedAt: true,
        sentAt: true,
        status: true,
        originalText: true,
        aiReply: true,
        finalReply: true,
        updatedAt: true
      }
    });
    expect(body.scope).toBe('all_sent');
    expect(body.count).toBe(1);
    expect(body.exportedAt).toEqual(expect.any(String));
    expect(body.messages).toEqual([
      {
        id: 'ticket-1',
        customerName: 'Maria Cliente',
        customerEmail: 'maria@example.com',
        subject: 'Consulta pedido',
        receivedAt: '2026-06-01T09:15:00.000Z',
        sentAt: '2026-06-01T09:45:00.000Z',
        status: 'edited_sent',
        wasEditedAndSent: true,
        originalMessage: 'Mensaje original del cliente',
        aiMessage: 'Respuesta IA',
        sentMessage: 'Respuesta enviada editada'
      }
    ]);
  });

  it('returns a controlled error when the database query fails', async () => {
    mocks.currentUser.mockResolvedValue({ id: 'user-1', email: 'admin@example.com' });
    mocks.ticketFindMany.mockRejectedValue(new Error('database down'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      error: 'No se pudo exportar el historico de enviados.'
    });
  });
});

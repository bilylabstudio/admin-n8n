import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  buildBotDataExportArchive: vi.fn()
}));

vi.mock('@/lib/auth', () => ({
  currentUser: mocks.currentUser
}));

vi.mock('@/lib/bot-data-export', () => ({
  buildBotDataExportArchive: mocks.buildBotDataExportArchive
}));

import { GET } from './route';

describe('GET /api/admin/export/bot-data', () => {
  beforeEach(() => {
    mocks.currentUser.mockReset();
    mocks.buildBotDataExportArchive.mockReset();
  });

  it('rejects unauthenticated users', async () => {
    mocks.currentUser.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, error: 'No autorizado' });
    expect(mocks.buildBotDataExportArchive).not.toHaveBeenCalled();
  });

  it('returns a ZIP download for authenticated admins', async () => {
    const bytes = new Uint8Array([80, 75, 3, 4]);
    mocks.currentUser.mockResolvedValue({ id: 'user-1', email: 'admin@example.com' });
    mocks.buildBotDataExportArchive.mockResolvedValue({
      filename: 'vgummies-bot-data-2026-07-08.zip',
      bytes,
      manifest: {
        exportedAt: '2026-07-08T12:00:00.000Z',
        version: 1,
        scope: 'bot_support',
        formats: ['sqlite', 'csv'],
        sqliteFile: 'bot-data.sqlite',
        tables: []
      }
    });

    const response = await GET();
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="vgummies-bot-data-2026-07-08.zip"'
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect([...body]).toEqual([...bytes]);
  });

  it('returns a controlled error when export generation fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exportError = new Error('database down');

    mocks.currentUser.mockResolvedValue({ id: 'user-1', email: 'admin@example.com' });
    mocks.buildBotDataExportArchive.mockRejectedValue(exportError);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith('Bot data export failed', exportError);
    expect(body).toEqual({
      ok: false,
      error: 'No se pudo exportar la base historica del bot.'
    });

    consoleError.mockRestore();
  });
});

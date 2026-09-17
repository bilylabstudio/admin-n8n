import { describe, expect, it, vi } from 'vitest';
import {
  appendSentCopy,
  buildRfc822Message,
  getWebmailSyncConfig,
  markAnswered,
  markSeen
} from './webmail-sync';

describe('webmail sync config', () => {
  it('is disabled by default without throwing', () => {
    const config = getWebmailSyncConfig({
      WEBMAIL_SYNC_ENABLED: 'false'
    });

    expect(config.enabled).toBe(false);
  });

  it('reports missing config when enabled without credentials', () => {
    const config = getWebmailSyncConfig({
      WEBMAIL_SYNC_ENABLED: 'true',
      WEBMAIL_IMAP_HOST: 'imap.example.com'
    });

    expect(config.enabled).toBe(false);
    if (config.enabled) throw new Error('expected disabled webmail config');
    expect(config.reason).toContain('WEBMAIL_IMAP_USER');
  });
});

describe('webmail sync operations', () => {
  it('skips markSeen when UID is missing', async () => {
    const result = await markSeen({
      uid: '',
      mailbox: 'INBOX',
      env: { WEBMAIL_SYNC_ENABLED: 'true' }
    });

    expect(result).toEqual({
      ok: true,
      skipped: true,
      action: 'seen',
      message: 'missing_imap_uid'
    });
  });

  it('adds Seen and Answered flags through the client factory', async () => {
    const flagsAdd = vi.fn().mockResolvedValue(undefined);
    const logout = vi.fn().mockResolvedValue(undefined);
    const lockRelease = vi.fn();
    const getMailboxLock = vi.fn().mockResolvedValue({ release: lockRelease });
    const connect = vi.fn().mockResolvedValue(undefined);

    const factory = vi.fn(() => ({
      connect,
      getMailboxLock,
      messageFlagsAdd: flagsAdd,
      logout,
      append: vi.fn()
    }));

    const env = {
      WEBMAIL_SYNC_ENABLED: 'true',
      WEBMAIL_IMAP_HOST: 'imap.example.com',
      WEBMAIL_IMAP_USER: 'info@example.com',
      WEBMAIL_IMAP_PASSWORD: 'secret',
      WEBMAIL_IMAP_PORT: '993',
      WEBMAIL_IMAP_SECURE: 'true',
      WEBMAIL_IMAP_MAILBOX: 'INBOX'
    };

    await expect(
      markSeen({ uid: '42', mailbox: 'INBOX', env, clientFactory: factory })
    ).resolves.toMatchObject({ ok: true, action: 'seen' });
    await expect(
      markAnswered({ uid: '42', mailbox: 'INBOX', env, clientFactory: factory })
    ).resolves.toMatchObject({ ok: true, action: 'answered' });

    expect(flagsAdd).toHaveBeenCalledWith('42', ['\\Seen'], { uid: true });
    expect(flagsAdd).toHaveBeenCalledWith('42', ['\\Seen', '\\Answered'], { uid: true });
    expect(lockRelease).toHaveBeenCalledTimes(2);
    expect(logout).toHaveBeenCalledTimes(2);
  });

  it('builds a sent-folder RFC822 message with reply headers', () => {
    const message = buildRfc822Message({
      from: 'info@v-gummies.com',
      to: 'cliente@example.com',
      subject: 'Re: Consulta',
      text: 'Hola',
      html: '<p>Hola</p>',
      sentAt: '2026-05-25T12:00:00.000Z',
      inReplyTo: '<original@example.com>',
      references: '<original@example.com>'
    });

    expect(message).toContain('From: info@v-gummies.com');
    expect(message).toContain('To: cliente@example.com');
    expect(message).toContain('Subject: Re: Consulta');
    expect(message).toContain('In-Reply-To: <original@example.com>');
    expect(message).toContain('References: <original@example.com>');
    expect(message).toContain('Content-Type: multipart/alternative;');
  });

  it('stays multipart/alternative (unchanged) when no attachments are passed', () => {
    const message = buildRfc822Message({
      from: 'info@v-gummies.com',
      to: 'cliente@example.com',
      subject: 'Re: Consulta',
      text: 'Hola',
      html: '<p>Hola</p>',
      sentAt: '2026-05-25T12:00:00.000Z',
      attachments: []
    });

    expect(message).toContain('Content-Type: multipart/alternative;');
    expect(message).not.toContain('multipart/mixed');
  });

  it('wraps the message in multipart/mixed with a base64 attachment part', () => {
    const contentBase64 = Buffer.from('contenido de prueba').toString('base64');
    const message = buildRfc822Message({
      from: 'info@v-gummies.com',
      to: 'cliente@example.com',
      subject: 'Re: Consulta',
      text: 'Hola',
      html: '<p>Hola</p>',
      sentAt: '2026-05-25T12:00:00.000Z',
      attachments: [{ filename: 'factura.pdf', mimeType: 'application/pdf', contentBase64 }]
    });

    expect(message).toContain('Content-Type: multipart/mixed;');
    expect(message).toContain('Content-Type: multipart/alternative;');
    expect(message).toContain('Content-Type: application/pdf; name="factura.pdf"');
    expect(message).toContain('Content-Disposition: attachment; filename="factura.pdf"');
    expect(message).toContain('Content-Transfer-Encoding: base64');
    expect(message).toContain(contentBase64);
    // Both the outer envelope and the original text/html parts must survive.
    expect(message).toContain('Hola');
    expect(message).toContain('<p>Hola</p>');
  });

  it('supports multiple attachments, each with its own MIME part', () => {
    const message = buildRfc822Message({
      from: 'info@v-gummies.com',
      to: 'cliente@example.com',
      subject: 'Re: Consulta',
      text: 'Hola',
      html: '<p>Hola</p>',
      sentAt: '2026-05-25T12:00:00.000Z',
      attachments: [
        { filename: 'foto1.jpg', mimeType: 'image/jpeg', contentBase64: 'Zm9vMQ==' },
        { filename: 'foto2.jpg', mimeType: 'image/jpeg', contentBase64: 'Zm9vMg==' }
      ]
    });

    expect(message.match(/Content-Disposition: attachment/g)?.length).toBe(2);
    expect(message).toContain('filename="foto1.jpg"');
    expect(message).toContain('filename="foto2.jpg"');
  });

  it('sanitizes attachment filenames that contain quotes or newlines', () => {
    const message = buildRfc822Message({
      from: 'info@v-gummies.com',
      to: 'cliente@example.com',
      subject: 'Re: Consulta',
      text: 'Hola',
      html: '<p>Hola</p>',
      sentAt: '2026-05-25T12:00:00.000Z',
      attachments: [{ filename: 'raro".txt\r\n', mimeType: 'text/plain', contentBase64: 'aGk=' }]
    });

    expect(message).not.toContain('raro".txt\r\n"');
  });

  it('skips sent append unless explicitly enabled', async () => {
    const result = await appendSentCopy({
      env: { WEBMAIL_SYNC_ENABLED: 'true', WEBMAIL_IMAP_APPEND_SENT_ENABLED: 'false' },
      message: 'From: info@v-gummies.com\r\n\r\nHola'
    });

    expect(result).toEqual({
      ok: true,
      skipped: true,
      action: 'append_sent',
      message: 'append_sent_disabled'
    });
  });
});

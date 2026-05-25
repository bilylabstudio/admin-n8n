import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUnique = vi.fn();
const upsert = vi.fn();
const auditCreate = vi.fn();

vi.mock('./db', () => ({
  db: {
    ticket: { findUnique, upsert },
    auditEvent: { create: auditCreate }
  }
}));

describe('ingestTicket', () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    auditCreate.mockReset();
    findUnique.mockResolvedValue(null);
    auditCreate.mockResolvedValue({});
  });

  it('stores optional IMAP metadata from n8n', async () => {
    const { ingestTicket } = await import('./tickets');
    upsert.mockImplementation(async (args) => ({ id: 'ticket-1', status: args.create.status }));

    await ingestTicket({
      external_message_id: 'message-id-1',
      customer_email: 'cliente@example.com',
      customer_name: 'Cliente',
      subject: 'Consulta',
      received_at: '2026-05-25T10:00:00.000Z',
      original_text: 'Hola',
      ai_reply: 'Respuesta',
      category: 'Soporte',
      intent: 'question',
      risk_flags: '',
      escalation_recommended: false,
      source: 'webmail',
      imap_uid: '123',
      imap_mailbox: 'INBOX',
      message_id: '<message-id-1@example.com>',
      in_reply_to: '<previous@example.com>',
      references: '<root@example.com> <previous@example.com>'
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          imapUid: '123',
          imapMailbox: 'INBOX',
          messageId: '<message-id-1@example.com>',
          inReplyTo: '<previous@example.com>',
          references: '<root@example.com> <previous@example.com>'
        }),
        update: expect.objectContaining({
          imapUid: '123',
          imapMailbox: 'INBOX',
          messageId: '<message-id-1@example.com>',
          inReplyTo: '<previous@example.com>',
          references: '<root@example.com> <previous@example.com>'
        })
      })
    );
  });
});

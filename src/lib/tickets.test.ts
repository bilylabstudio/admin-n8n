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
      ai_confidence: 0.42,
      confidence_label: 'baja',
      routed_template_id: 'sub_baja_generica',
      route_source: 'canonical_router',
      sentiment: 'molesto',
      sentiment_source: 'live_classifier',
      requires_review: true,
      case_reasoning: { family: 'mensaje_simple', diagnosis: 'cierre' },
      critic: { safe: true, issues: [] },
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
          references: '<root@example.com> <previous@example.com>',
          aiConfidence: 0.42,
          confidenceLabel: 'baja',
          routedTemplateId: 'sub_baja_generica',
          routeSource: 'canonical_router',
          sentiment: 'molesto',
          sentimentSource: 'live_classifier',
          requiresReview: true,
          caseReasoningJson: { family: 'mensaje_simple', diagnosis: 'cierre' },
          criticJson: { safe: true, issues: [] }
        }),
        update: expect.objectContaining({
          imapUid: '123',
          imapMailbox: 'INBOX',
          messageId: '<message-id-1@example.com>',
          inReplyTo: '<previous@example.com>',
          references: '<root@example.com> <previous@example.com>',
          aiConfidence: 0.42,
          confidenceLabel: 'baja',
          routedTemplateId: 'sub_baja_generica',
          routeSource: 'canonical_router',
          sentiment: 'molesto',
          sentimentSource: 'live_classifier',
          requiresReview: true,
          caseReasoningJson: { family: 'mensaje_simple', diagnosis: 'cierre' },
          criticJson: { safe: true, issues: [] }
        })
      })
    );
  });

  it('does not clear existing route and sentiment metrics when an older payload omits them', async () => {
    const { ingestTicket } = await import('./tickets');
    findUnique.mockResolvedValue({ id: 'ticket-1', status: 'pending_review' });
    upsert.mockImplementation(async (args) => ({ id: 'ticket-1', status: args.update.status }));

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
      confidence_label: '',
      routed_template_id: '',
      route_source: '',
      sentiment_source: '',
      requires_review: false,
      source: 'webmail',
      imap_uid: '',
      imap_mailbox: '',
      message_id: '',
      in_reply_to: '',
      references: ''
    });

    const update = upsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty('routedTemplateId');
    expect(update).not.toHaveProperty('routeSource');
    expect(update).not.toHaveProperty('sentiment');
    expect(update).not.toHaveProperty('sentimentSource');
  });
});

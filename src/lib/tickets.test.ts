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
      auto_discard: false,
      discard_reason: '',
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
      auto_discard: false,
      discard_reason: '',
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

  it('clears stale template id when a routed draft has no canonical template', async () => {
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
      ai_reply: 'Respuesta libre',
      category: 'Soporte',
      intent: 'question',
      risk_flags: '',
      escalation_recommended: false,
      confidence_label: 'open_question_guard',
      routed_template_id: '',
      route_source: 'open_subscription_question',
      sentiment_source: '',
      requires_review: false,
      auto_discard: false,
      discard_reason: '',
      source: 'webmail',
      imap_uid: '',
      imap_mailbox: '',
      message_id: '',
      in_reply_to: '',
      references: ''
    });

    expect(upsert.mock.calls[0][0].update).toEqual(
      expect.objectContaining({
        routedTemplateId: null,
        routeSource: 'open_subscription_question'
      })
    );
  });

  it('creates auto-discarded tickets without an AI reply or review flag', async () => {
    const { ingestTicket } = await import('./tickets');
    upsert.mockImplementation(async (args) => ({ id: 'ticket-1', status: args.create.status }));

    await ingestTicket({
      external_message_id: 'message-id-discard',
      customer_email: 'cliente@example.com',
      customer_name: 'Cliente',
      subject: 'Re: Consulta',
      received_at: '2026-06-28T10:00:00.000Z',
      original_text: 'Gracias',
      ai_reply: 'Gracias a ti.',
      category: 'Feedback positivo',
      intent: 'no_reply',
      risk_flags: '',
      escalation_recommended: true,
      confidence_label: 'closing',
      routed_template_id: '',
      route_source: '',
      sentiment_source: '',
      requires_review: true,
      auto_discard: true,
      discard_reason: 'simple_closing',
      source: 'webmail',
      imap_uid: '',
      imap_mailbox: '',
      message_id: '',
      in_reply_to: '',
      references: ''
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'discarded',
          aiReply: '',
          category: 'Feedback positivo',
          intent: 'no_reply',
          riskFlags: 'auto_discard,discard_reason:simple_closing',
          escalationRecommended: false,
          requiresReview: false
        }),
        update: expect.objectContaining({
          status: 'discarded',
          aiReply: '',
          riskFlags: 'auto_discard,discard_reason:simple_closing',
          escalationRecommended: false,
          requiresReview: false
        })
      })
    );
  });

  it('does not overwrite terminal tickets from ingest', async () => {
    const { ingestTicket } = await import('./tickets');
    const existing = { id: 'ticket-1', status: 'approved_sent' };
    findUnique.mockResolvedValue(existing);

    const ticket = await ingestTicket({
      external_message_id: 'message-id-terminal',
      customer_email: 'cliente@example.com',
      customer_name: 'Cliente',
      subject: 'Re: Consulta',
      received_at: '2026-06-28T10:00:00.000Z',
      original_text: 'Gracias',
      ai_reply: '',
      category: 'Feedback positivo',
      intent: 'no_reply',
      risk_flags: '',
      escalation_recommended: false,
      confidence_label: '',
      routed_template_id: '',
      route_source: '',
      sentiment_source: '',
      requires_review: false,
      auto_discard: true,
      discard_reason: 'simple_closing',
      source: 'webmail',
      imap_uid: '',
      imap_mailbox: '',
      message_id: '',
      in_reply_to: '',
      references: ''
    });

    expect(ticket).toBe(existing);
    expect(upsert).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('keeps regular AI replies in pending review', async () => {
    const { ingestTicket } = await import('./tickets');
    upsert.mockImplementation(async (args) => ({ id: 'ticket-1', status: args.create.status }));

    await ingestTicket({
      external_message_id: 'message-id-normal',
      customer_email: 'cliente@example.com',
      customer_name: 'Cliente',
      subject: 'Consulta',
      received_at: '2026-06-28T10:00:00.000Z',
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
      auto_discard: false,
      discard_reason: '',
      source: 'webmail',
      imap_uid: '',
      imap_mailbox: '',
      message_id: '',
      in_reply_to: '',
      references: ''
    });

    expect(upsert.mock.calls[0][0].create).toEqual(
      expect.objectContaining({
        status: 'pending_review',
        aiReply: 'Respuesta'
      })
    );
  });
});

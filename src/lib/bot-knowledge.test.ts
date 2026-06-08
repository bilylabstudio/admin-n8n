import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformOrderFindMany = vi.fn();
const ticketFindMany = vi.fn();
const supportApprovedResponseFindMany = vi.fn();

vi.mock('./db', () => ({
  db: {
    platformOrder: { findMany: platformOrderFindMany },
    ticket: { findMany: ticketFindMany },
    supportApprovedResponse: { findMany: supportApprovedResponseFindMany }
  }
}));

describe('getBotKnowledge', () => {
  beforeEach(() => {
    platformOrderFindMany.mockReset();
    ticketFindMany.mockReset();
    supportApprovedResponseFindMany.mockReset();

    platformOrderFindMany.mockResolvedValue([]);
    ticketFindMany.mockResolvedValue([]);
    supportApprovedResponseFindMany.mockResolvedValue([]);
  });

  it('returns orders, previous tickets, and approved response candidates', async () => {
    const { getBotKnowledge } = await import('./bot-knowledge');
    platformOrderFindMany
      .mockResolvedValueOnce([
        {
          id: 'email-order',
          platform: 'shopify',
          orderNumber: '#1001',
          externalOrderId: '1001',
          processedAt: new Date('2026-06-01T09:00:00.000Z'),
          totalPrice: '29.90',
          currency: 'EUR',
          financialStatus: 'paid',
          fulfillmentStatus: null,
          cancelledAt: null
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'number-order',
          platform: 'shopify',
          orderNumber: '#45405',
          externalOrderId: '45405',
          processedAt: new Date('2026-06-05T09:00:00.000Z'),
          totalPrice: '59.90',
          currency: 'EUR',
          financialStatus: 'paid',
          fulfillmentStatus: 'fulfilled',
          cancelledAt: null
        }
      ]);
    ticketFindMany.mockResolvedValue([
      {
        id: 'ticket-previous',
        externalMessageId: 'old-message',
        subject: 'Gracias',
        receivedAt: new Date('2026-06-06T10:00:00.000Z'),
        status: 'edited_sent',
        category: 'General',
        intent: 'closing',
        riskFlags: '',
        aiConfidence: 0.91,
        confidenceLabel: 'alta',
        requiresReview: false,
        originalText: 'Gracias por la informacion',
        aiReply: 'Gracias a ti.',
        finalReply: 'Gracias a ti.',
        sentAt: new Date('2026-06-06T10:05:00.000Z'),
        updatedAt: new Date('2026-06-06T10:06:00.000Z')
      }
    ]);
    supportApprovedResponseFindMany.mockResolvedValue([
      {
        id: 'approved-1',
        caseId: 'simple-thanks-v1',
        family: 'mensaje_simple',
        subintent: 'agradecimiento_sin_pregunta',
        customerExample: 'Gracias por la ayuda',
        approvedResponse: 'Gracias a ti, {nombre}.',
        mustInclude: ['agradecimiento breve'],
        mustNotInclude: ['reembolso'],
        status: 'approved',
        priority: 100,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    const knowledge = await getBotKnowledge({
      external_message_id: 'new-message',
      customer_email: ' CLIENTE@Example.com ',
      customer_name: 'Cliente',
      subject: 'Pedido #45405',
      message: 'Gracias por la ayuda del pedido #45405',
      classification: {
        family: 'mensaje_simple',
        subintent: 'agradecimiento_sin_pregunta',
        has_new_request: false,
        conversation_stage: 'closing'
      }
    });

    expect(knowledge.customer_email).toBe('cliente@example.com');
    expect(knowledge.order_number_candidates).toEqual(['45405']);
    expect(knowledge.recent_orders.map((order) => order.id)).toEqual([
      'number-order',
      'email-order'
    ]);
    expect(knowledge.previous_tickets[0]).toEqual(
      expect.objectContaining({
        id: 'ticket-previous',
        status: 'edited_sent',
        customer_message: 'Gracias por la informacion',
        last_reply: 'Gracias a ti.'
      })
    );
    expect(knowledge.approved_response_candidates[0]).toEqual(
      expect.objectContaining({
        case_id: 'simple-thanks-v1',
        family: 'mensaje_simple',
        subintent: 'agradecimiento_sin_pregunta',
        must_include: ['agradecimiento breve'],
        must_not_include: ['reembolso']
      })
    );
    expect(knowledge.retrieval).toEqual(
      expect.objectContaining({
        orders_found: 2,
        previous_ticket_count: 1,
        approved_response_count: 1,
        used_email_lookup: true,
        used_order_number_lookup: true
      })
    );
  });

  it('keeps generating knowledge when approved response lookup fails', async () => {
    const { getBotKnowledge } = await import('./bot-knowledge');
    platformOrderFindMany.mockResolvedValue([]);
    ticketFindMany.mockResolvedValue([]);
    supportApprovedResponseFindMany.mockRejectedValue(new Error('table missing'));

    await expect(
      getBotKnowledge({
        customer_email: 'cliente@example.com',
        message: 'Hola'
      })
    ).resolves.toEqual(
      expect.objectContaining({
        customer_email: 'cliente@example.com',
        approved_response_candidates: [],
        retrieval: expect.objectContaining({
          approved_response_count: 0
        })
      })
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildSentExportPayload,
  SENT_EXPORT_STATUSES,
  toSentExportMessage,
  type SentExportTicket
} from './sent-export';

const baseTicket: SentExportTicket = {
  id: 'ticket-1',
  customerName: 'Maria Cliente',
  customerEmail: 'maria@example.com',
  subject: 'Consulta pedido',
  receivedAt: new Date('2026-06-01T09:15:00.000Z'),
  sentAt: new Date('2026-06-01T09:45:00.000Z'),
  status: 'approved_sent',
  originalText: 'Hola, donde esta mi pedido?',
  aiReply: 'Hola Maria, revisamos tu pedido.',
  finalReply: null,
  updatedAt: new Date('2026-06-01T09:45:30.000Z')
};

describe('sent export helpers', () => {
  it('declares the statuses included in the full sent export', () => {
    expect(SENT_EXPORT_STATUSES).toEqual(['approved_sent', 'edited_sent']);
  });

  it('serializes a sent ticket with the original customer message', () => {
    expect(toSentExportMessage(baseTicket)).toEqual({
      id: 'ticket-1',
      customerName: 'Maria Cliente',
      customerEmail: 'maria@example.com',
      subject: 'Consulta pedido',
      receivedAt: '2026-06-01T09:15:00.000Z',
      sentAt: '2026-06-01T09:45:00.000Z',
      status: 'approved_sent',
      wasEditedAndSent: false,
      originalMessage: 'Hola, donde esta mi pedido?',
      aiMessage: 'Hola Maria, revisamos tu pedido.',
      sentMessage: 'Hola Maria, revisamos tu pedido.'
    });
  });

  it('uses finalReply for edited sent tickets', () => {
    expect(
      toSentExportMessage({
        ...baseTicket,
        id: 'ticket-2',
        status: 'edited_sent',
        finalReply: 'Hola Maria, tu pedido sale hoy.'
      })
    ).toMatchObject({
      id: 'ticket-2',
      wasEditedAndSent: true,
      sentMessage: 'Hola Maria, tu pedido sale hoy.'
    });
  });

  it('builds the full export payload with count and scope', () => {
    const payload = buildSentExportPayload(
      [
        baseTicket,
        {
          ...baseTicket,
          id: 'ticket-3',
          customerName: null,
          customerEmail: 'ana@example.com',
          status: 'edited_sent',
          finalReply: 'Respuesta final editada'
        }
      ],
      new Date('2026-06-10T12:00:00.000Z')
    );

    expect(payload).toEqual({
      exportedAt: '2026-06-10T12:00:00.000Z',
      scope: 'all_sent',
      count: 2,
      messages: [
        expect.objectContaining({ id: 'ticket-1', originalMessage: 'Hola, donde esta mi pedido?' }),
        expect.objectContaining({
          id: 'ticket-3',
          customerName: null,
          sentMessage: 'Respuesta final editada'
        })
      ]
    });
  });
});

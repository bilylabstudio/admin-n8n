import { describe, expect, it } from 'vitest';
import {
  buildSentExportPayload,
  SENT_EXPORT_STATUSES,
  toSentExportMessage,
  type SentExportTicket
} from './sent-export';

const baseTicket: SentExportTicket = {
  originalText: 'Hola, donde esta mi pedido?',
  aiReply: 'Hola Maria, revisamos tu pedido.',
  finalReply: null
};

describe('sent export helpers', () => {
  it('declares the statuses included in the full sent export', () => {
    expect(SENT_EXPORT_STATUSES).toEqual(['approved_sent', 'edited_sent']);
  });

  it('serializes only the original customer message and sent reply', () => {
    expect(toSentExportMessage(baseTicket)).toEqual({
      originalMessage: 'Hola, donde esta mi pedido?',
      sentMessage: 'Hola Maria, revisamos tu pedido.'
    });
  });

  it('uses finalReply for the sent message when it exists', () => {
    expect(
      toSentExportMessage({
        ...baseTicket,
        finalReply: 'Hola Maria, tu pedido sale hoy.'
      })
    ).toEqual({
      originalMessage: 'Hola, donde esta mi pedido?',
      sentMessage: 'Hola Maria, tu pedido sale hoy.'
    });
  });

  it('builds the full export payload with count and scope', () => {
    const payload = buildSentExportPayload(
      [
        baseTicket,
        {
          ...baseTicket,
          originalText: 'Antes del desayuno?',
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
        {
          originalMessage: 'Hola, donde esta mi pedido?',
          sentMessage: 'Hola Maria, revisamos tu pedido.'
        },
        {
          originalMessage: 'Antes del desayuno?',
          sentMessage: 'Respuesta final editada'
        }
      ]
    });
  });
});

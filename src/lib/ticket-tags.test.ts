import { describe, expect, it } from 'vitest';
import { getTicketTags } from './ticket-tags';

const baseTicket = {
  subject: '',
  originalText: '',
  category: '',
  intent: '',
  riskFlags: '',
  escalationRecommended: false
};

describe('getTicketTags', () => {
  it('returns Escalar when escalation is recommended', () => {
    expect(getTicketTags({ ...baseTicket, escalationRecommended: true }).map((tag) => tag.id)).toEqual(['escalate']);
  });

  it('does not escalate only because the customer asks to review something', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        originalText: 'Por favor revisa mi pedido cuando puedas'
      }).map((tag) => tag.id)
    ).not.toContain('escalate');
  });

  it('returns Devolucion for refund and cancellation language', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        subject: 'Quiero cancelar mi pedido',
        originalText: 'Necesito una devolucion o reembolso del dinero'
      }).map((tag) => tag.id)
    ).toContain('refund');
  });

  it('returns Problema envio for shipping and tracking language', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        category: 'Logistica de Web',
        intent: 'order_status',
        originalText: 'No he recibido el pedido y no llega el seguimiento de Tipsa'
      }).map((tag) => tag.id)
    ).toContain('shipping');
  });

  it('returns Problema envio for delayed delivery language from the examples', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        originalText: 'Todavia no me han llegado, la empresa de mensajeria Tipsa dice que llegan el lunes'
      }).map((tag) => tag.id)
    ).toContain('shipping');
  });

  it('returns Problema producto for dosage and results language', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        category: 'Producto/Salud',
        originalText: 'No noto efectos y quiero saber la dosis para tomar las gomitas'
      }).map((tag) => tag.id)
    ).toContain('product');
  });

  it('can return multiple tags in stable order', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        escalationRecommended: true,
        originalText: 'No he recibido mi pedido y quiero cancelar'
      }).map((tag) => tag.id)
    ).toEqual(['escalate', 'refund', 'shipping']);
  });

  it('returns an empty list when there are no matches', () => {
    expect(getTicketTags({ ...baseTicket, originalText: 'Muchas gracias por la informacion' })).toEqual([]);
  });
});

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

  it('returns Escalar when the bot flags requires_review / human_review (reasoned reply)', () => {
    expect(
      getTicketTags({ ...baseTicket, riskFlags: 'requires_review,human_review' }).map((tag) => tag.id)
    ).toContain('escalate');
  });

  it('returns Escalar for the reasoned_reply route even without escalationRecommended', () => {
    expect(
      getTicketTags({ ...baseTicket, riskFlags: 'human_review', intent: 'reasoned_reply' }).map((tag) => tag.id)
    ).toContain('escalate');
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

  it('returns Incidencia almacen when the bot flags incidencia_almacen', () => {
    expect(
      getTicketTags({ ...baseTicket, riskFlags: 'incidencia_almacen' }).map((tag) => tag.id)
    ).toContain('warehouse');
  });

  it('returns Enviar unidad extra when the bot flags error_3x2', () => {
    expect(
      getTicketTags({ ...baseTicket, riskFlags: 'error_3x2' }).map((tag) => tag.id)
    ).toContain('office_3x2');
  });

  it('returns Incidencia transporte when the bot flags incidencia_transporte', () => {
    expect(
      getTicketTags({ ...baseTicket, riskFlags: 'incidencia_transporte' }).map((tag) => tag.id)
    ).toEqual(['carrier_incident']);
  });

  it('returns Incidencia transporte for explicit Tipsa absence incidents', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        originalText: 'TIPSA me marca ausente pero estaba en casa'
      }).map((tag) => tag.id)
    ).toEqual(['carrier_incident', 'shipping']);
  });

  it('returns Incidencia transporte for lost packages with Tipsa', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        originalText: 'Me han perdido el paquete en TIPSA'
      }).map((tag) => tag.id)
    ).toEqual(['carrier_incident', 'shipping']);
  });

  it('does not return Incidencia transporte for generic delivery delay language', () => {
    const ids = getTicketTags({
      ...baseTicket,
      originalText: 'No he recibido mi pedido'
    }).map((tag) => tag.id);
    expect(ids).toEqual(['shipping']);
    expect(ids).not.toContain('carrier_incident');
  });

  it('does not return Incidencia transporte for subscription cancellation', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        originalText: 'Quiero cancelar la suscripcion, gracias'
      }).map((tag) => tag.id)
    ).toEqual(['refund']);
  });

  it('does NOT flag the incidence just because the customer mentions it in the message', () => {
    const ids = getTicketTags({
      ...baseTicket,
      originalText: 'tuve un error 3x2 y creo que hay una incidencia en el almacen'
    }).map((tag) => tag.id);
    expect(ids).not.toContain('warehouse');
    expect(ids).not.toContain('office_3x2');
  });

  it('puts the warehouse incidence chip before escalate', () => {
    expect(
      getTicketTags({ ...baseTicket, riskFlags: 'incidencia_almacen', escalationRecommended: true }).map(
        (tag) => tag.id
      )
    ).toEqual(['warehouse', 'escalate']);
  });
});

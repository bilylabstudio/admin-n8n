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

  // ====== Chips de intencion derivados de la CLASIFICACION del bot, no del texto ======

  it('returns Devolucion from the bot intent (refund_status / return / subscription_cancel)', () => {
    expect(getTicketTags({ ...baseTicket, intent: 'refund_status' }).map((t) => t.id)).toContain('refund');
    expect(getTicketTags({ ...baseTicket, intent: 'return' }).map((t) => t.id)).toContain('refund');
    expect(getTicketTags({ ...baseTicket, intent: 'subscription_cancel' }).map((t) => t.id)).toEqual(['refund']);
  });

  it('returns Devolucion from the bot category (Devolucion/Reclamo)', () => {
    expect(getTicketTags({ ...baseTicket, category: 'Devolucion/Reclamo' }).map((t) => t.id)).toContain('refund');
  });

  it('returns Problema envio from the bot classification (order_status / Logistica)', () => {
    expect(
      getTicketTags({ ...baseTicket, category: 'Logistica de Web', intent: 'order_status' }).map((t) => t.id)
    ).toContain('shipping');
  });

  it('returns Problema producto from the bot classification (product / Producto/*)', () => {
    expect(getTicketTags({ ...baseTicket, intent: 'product' }).map((t) => t.id)).toContain('product');
    expect(getTicketTags({ ...baseTicket, category: 'Producto/Stock' }).map((t) => t.id)).toContain('product');
  });

  it('can return multiple tags in stable order', () => {
    expect(
      getTicketTags({
        ...baseTicket,
        escalationRecommended: true,
        category: 'Devolucion/Reclamo',
        intent: 'order_status'
      }).map((tag) => tag.id)
    ).toEqual(['escalate', 'refund', 'shipping']);
  });

  it('returns an empty list when there are no matches', () => {
    expect(getTicketTags({ ...baseTicket, originalText: 'Muchas gracias por la informacion' })).toEqual([]);
  });

  // ====== La clave del cambio: el texto crudo del cliente NO dispara chips ======

  it('does NOT derive intent chips from raw customer text without a bot classification', () => {
    const ids = getTicketTags({
      ...baseTicket,
      subject: 'devolucion',
      originalText: 'devolucion reembolso no me ha llegado no noto efectos gomitas'
    }).map((t) => t.id);
    expect(ids).toEqual([]);
  });

  it('does not tag Devolucion/Problema producto just because the message says "suscripcion"/"me funcionan" (caso Rocio)', () => {
    const ids = getTicketTags({
      ...baseTicket,
      subject: 'pedido #51740',
      originalText: 'Me gustaria recibir el pedido sin la suscripcion! Si me funcionan ya lo vuelvo a pedir!',
      category: 'Incidencia en Pedido',
      intent: 'order_claim'
    }).map((t) => t.id);
    expect(ids).not.toContain('refund');
    expect(ids).not.toContain('product');
  });

  // ====== Incidencias operativas puestas por el bot (riskFlags) ======

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

  it('returns Incidencia transporte (and Problema envio) when the bot flags incidencia_transporte', () => {
    expect(
      getTicketTags({ ...baseTicket, riskFlags: 'incidencia_transporte' }).map((tag) => tag.id)
    ).toEqual(['carrier_incident', 'shipping']);
  });

  it('returns Incidencia transporte for explicit Tipsa absence incidents (text signal is allowed for carrier)', () => {
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

  it('does not derive shipping from a generic "no he recibido" without a classification', () => {
    const ids = getTicketTags({
      ...baseTicket,
      originalText: 'No he recibido mi pedido'
    }).map((tag) => tag.id);
    expect(ids).toEqual([]);
    expect(ids).not.toContain('carrier_incident');
  });

  it('returns only Devolucion for a subscription cancellation classification (not carrier)', () => {
    const ids = getTicketTags({
      ...baseTicket,
      intent: 'subscription_cancel',
      originalText: 'Quiero cancelar la suscripcion, gracias'
    }).map((tag) => tag.id);
    expect(ids).toEqual(['refund']);
    expect(ids).not.toContain('carrier_incident');
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

import { describe, expect, it } from 'vitest';
import {
  formatCustomerOrderLine,
  formatOrderCountLabel,
  fulfillmentStatusLabel,
  paymentStatusLabel
} from './customer-profile-view';

describe('customer profile view helpers', () => {
  it('formats singular and plural order count labels', () => {
    expect(formatOrderCountLabel(1)).toBe('1 pedido encontrado');
    expect(formatOrderCountLabel(3)).toBe('3 pedidos encontrados');
  });

  it('formats a full order line for the tooltip', () => {
    expect(
      formatCustomerOrderLine({
        id: 'order-1',
        platform: 'shopify',
        orderNumber: '#27215069513',
        processedAt: '2026-06-02T08:30:00.000Z',
        totalPrice: '49.9',
        currency: 'EUR',
        financialStatus: 'paid',
        fulfillmentStatus: 'fulfilled',
        cancelledAt: null
      })
    ).toBe('#27215069513 - 02/06/2026 - 49,90 EUR - pagado - enviado');
  });

  it('falls back when date, amount, or order number are incomplete', () => {
    expect(
      formatCustomerOrderLine({
        id: 'fallback-id',
        platform: 'shopify',
        orderNumber: '',
        processedAt: 'not-a-date',
        totalPrice: 'not-a-number',
        currency: 'EUR',
        financialStatus: '',
        fulfillmentStatus: null,
        cancelledAt: null
      })
    ).toBe('#fallback-id - fecha sin datos - not-a-number EUR - pago sin datos - sin envio');
  });

  it('marks cancelled orders in the fulfillment slot', () => {
    expect(
      fulfillmentStatusLabel({
        fulfillmentStatus: 'fulfilled',
        cancelledAt: '2026-06-03T00:00:00.000Z'
      })
    ).toBe('cancelado');
  });

  it('marks subscription orders in the tooltip line', () => {
    expect(
      formatCustomerOrderLine({
        id: 'order-sub',
        platform: 'shopify',
        orderNumber: '#50111',
        processedAt: '2026-06-25T08:47:00.000Z',
        totalPrice: '74.97',
        currency: 'EUR',
        financialStatus: 'paid',
        fulfillmentStatus: null,
        cancelledAt: null,
        isSubscriptionOrder: true
      })
    ).toBe('#50111 - 25/06/2026 - 74,97 EUR - pagado - sin envio - suscripcion');
  });

  it('translates common payment and fulfillment statuses', () => {
    expect(paymentStatusLabel('paid')).toBe('pagado');
    expect(paymentStatusLabel('pending')).toBe('pendiente');
    expect(paymentStatusLabel('refunded')).toBe('reembolsado');
    expect(fulfillmentStatusLabel({ fulfillmentStatus: 'partial', cancelledAt: null })).toBe(
      'parcial'
    );
    expect(fulfillmentStatusLabel({ fulfillmentStatus: 'fulfilled', cancelledAt: null })).toBe(
      'enviado'
    );
  });
});

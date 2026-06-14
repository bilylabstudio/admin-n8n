import { describe, expect, it } from 'vitest';
import { parseTikTokShopOrders } from './tiktok-shop-orders';

describe('parseTikTokShopOrders', () => {
  it('maps paid TikTok Shop orders to platform orders and sums units', () => {
    const result = parseTikTokShopOrders({
      data: {
        orders: [
          {
            id: 'tt-100',
            order_number: 'TT100',
            status: 'AWAITING_SHIPMENT',
            create_time: 1_782_892_800,
            update_time: 1_782_896_400,
            currency: 'EUR',
            payment: {
              sub_total: '32.00',
              tax: '0.00',
              shipping_fee: '3.99',
              total_discount: '5.00',
              total_amount: '30.99'
            },
            line_items: [{ quantity: 2 }, { quantity: 1 }],
            recipient_address: { region_code: 'ES' }
          }
        ]
      }
    });

    expect(result.rowsSkipped).toEqual([]);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      platform: 'tiktok_shop',
      external_order_id: 'tt-100',
      order_number: 'TT100',
      currency: 'EUR',
      processed_at: '2026-07-01T08:00:00.000Z',
      financial_status: 'paid',
      fulfillment_status: 'unfulfilled_tiktok_shop',
      cancelled_at: null,
      subtotal: '32.00',
      total_tax: '0.00',
      total_shipping: '3.99',
      total_discounts: '5.00',
      total_price: '30.99',
      total_refunded: '0.00',
      total_units: 3,
      customer_email: null,
      country_code: 'ES',
      channel: 'tiktok_shop',
      external_updated_at: '2026-07-01T09:00:00.000Z'
    });
  });

  it('marks cancelled orders as voided', () => {
    const result = parseTikTokShopOrders([
      {
        order_id: 'tt-cancelled',
        status: 'CANCELLED',
        create_time: '2026-06-01T10:00:00.000Z',
        update_time: '2026-06-01T11:00:00.000Z',
        cancel_time: '2026-06-01T11:30:00.000Z',
        total_amount: '19.90',
        currency: 'EUR'
      }
    ]);

    expect(result.orders[0]).toMatchObject({
      external_order_id: 'tt-cancelled',
      financial_status: 'voided',
      fulfillment_status: 'cancelled_tiktok_shop',
      cancelled_at: '2026-06-01T11:30:00.000Z'
    });
  });

  it('detects refunded orders and skips invalid rows', () => {
    const result = parseTikTokShopOrders([
      { id: '', create_time: '2026-06-01T10:00:00.000Z' },
      {
        id: 'tt-refund',
        status: 'COMPLETED',
        create_time: '2026-06-02T10:00:00.000Z',
        update_time: '2026-06-02T12:00:00.000Z',
        total_amount: '40.00',
        refund_amount: '15.00',
        items: [{ qty: '1' }]
      }
    ]);

    expect(result.rowsSkipped).toEqual([{ index: 0, reason: 'missing_order_id' }]);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      external_order_id: 'tt-refund',
      financial_status: 'partially_refunded',
      total_price: '40.00',
      total_refunded: '15.00',
      total_units: 1
    });
  });
});

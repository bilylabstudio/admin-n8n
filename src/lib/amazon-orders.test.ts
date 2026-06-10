import { describe, expect, it } from 'vitest';
import { parseAmazonOrdersTsv } from './amazon-orders';

const header = [
  'amazon-order-id',
  'merchant-order-id',
  'purchase-date',
  'last-updated-date',
  'order-status',
  'fulfillment-channel',
  'sales-channel',
  'order-channel',
  'quantity',
  'currency',
  'item-price',
  'item-tax',
  'shipping-price',
  'shipping-tax',
  'gift-wrap-price',
  'gift-wrap-tax',
  'item-promotion-discount',
  'ship-promotion-discount',
  'ship-country'
].join('\t');

describe('parseAmazonOrdersTsv', () => {
  it('groups item rows by Amazon order and sums money fields', () => {
    const tsv = [
      header,
      [
        '407-1111111-1111111',
        'M-100',
        '2026-02-03T10:00:00+00:00',
        '2026-02-03T12:00:00+00:00',
        'Shipped',
        'AFN',
        'Amazon.es',
        '',
        '2',
        'EUR',
        '30.00',
        '3.00',
        '4.00',
        '0.84',
        '',
        '',
        '5.00',
        '',
        'ES'
      ].join('\t'),
      [
        '407-1111111-1111111',
        'M-100',
        '2026-02-03T10:00:00+00:00',
        '2026-02-03T12:30:00+00:00',
        'Shipped',
        'AFN',
        'Amazon.es',
        '',
        '1',
        'EUR',
        '10.00',
        '1.00',
        '',
        '',
        '',
        '',
        '',
        '',
        'ES'
      ].join('\t')
    ].join('\n');

    const result = parseAmazonOrdersTsv(tsv);

    expect(result.rowsSkipped).toEqual([]);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      platform: 'amazon',
      external_order_id: '407-1111111-1111111',
      order_number: 'M-100',
      currency: 'EUR',
      processed_at: '2026-02-03T10:00:00.000Z',
      financial_status: 'paid',
      fulfillment_status: 'fulfilled_afn',
      cancelled_at: null,
      subtotal: '40.00',
      total_tax: '4.84',
      total_shipping: '4.00',
      total_discounts: '5.00',
      total_price: '43.84',
      total_refunded: '0.00',
      total_units: 3,
      customer_email: null,
      country_code: 'ES',
      channel: 'Amazon.es',
      external_updated_at: '2026-02-03T12:30:00.000Z'
    });
  });

  it('marks cancelled Amazon orders as voided and sets cancelled_at', () => {
    const tsv = [
      header,
      [
        '407-2222222-2222222',
        '',
        '2026-03-01T08:00:00+00:00',
        '2026-03-01T09:00:00+00:00',
        'Canceled',
        'MFN',
        'Amazon.es',
        '',
        '1',
        'EUR',
        '19.99',
        '0',
        '',
        '',
        '',
        '',
        '',
        '',
        'ES'
      ].join('\t')
    ].join('\n');

    const result = parseAmazonOrdersTsv(tsv);

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      external_order_id: '407-2222222-2222222',
      order_number: '407-2222222-2222222',
      financial_status: 'voided',
      fulfillment_status: 'cancelled_mfn',
      cancelled_at: '2026-03-01T09:00:00.000Z'
    });
  });

  it('skips rows without an amazon-order-id and keeps valid rows', () => {
    const tsv = [
      header,
      [
        '',
        'M-BAD',
        '2026-04-01T08:00:00+00:00',
        '2026-04-01T09:00:00+00:00',
        'Shipped',
        'AFN',
        'Amazon.es',
        '',
        '1',
        'EUR',
        '20.00',
        '0',
        '',
        '',
        '',
        '',
        '',
        '',
        'ES'
      ].join('\t'),
      [
        '407-3333333-3333333',
        'M-333',
        '2026-04-02T08:00:00+00:00',
        '2026-04-02T09:00:00+00:00',
        'Unshipped',
        'AFN',
        'Amazon.es',
        '',
        '1',
        'EUR',
        '20.00',
        '0',
        '',
        '',
        '',
        '',
        '',
        '',
        'ES'
      ].join('\t')
    ].join('\n');

    const result = parseAmazonOrdersTsv(tsv);

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].external_order_id).toBe('407-3333333-3333333');
    expect(result.rowsSkipped).toEqual([{ line: 2, reason: 'missing_amazon_order_id' }]);
  });
});

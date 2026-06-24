import { describe, expect, it } from 'vitest';
import {
  financialTransactionsBatchSchema,
  platformFinancialTransactionInputSchema
} from './platform-financial-transactions';

describe('platformFinancialTransactionInputSchema', () => {
  it('normalizes numeric money inputs to decimal strings', () => {
    const parsed = platformFinancialTransactionInputSchema.parse({
      platform: 'shopify',
      provider: 'shopify_payments',
      external_transaction_id: 'gid://shopify/ShopifyPaymentsBalanceTransaction/1',
      external_order_id: '1001',
      order_number: '#1001',
      currency: 'EUR',
      gross_amount: 100,
      fee_amount: 2.5,
      net_amount: 97.5,
      transaction_type: 'charge',
      transaction_status: 'available',
      posted_at: '2026-06-20T10:00:00.000Z'
    });

    expect(parsed.gross_amount).toBe('100');
    expect(parsed.fee_amount).toBe('2.5');
    expect(parsed.net_amount).toBe('97.5');
  });

  it('accepts a batch payload with at least one transaction', () => {
    const parsed = financialTransactionsBatchSchema.parse({
      transactions: [
        {
          platform: 'amazon',
          provider: 'amazon_finances',
          external_transaction_id: 'amz-tx-1',
          currency: 'EUR',
          gross_amount: '35.00',
          fee_amount: '5.25',
          net_amount: '29.75',
          posted_at: '2026-06-20T10:00:00.000Z'
        }
      ]
    });

    expect(parsed.transactions).toHaveLength(1);
  });

  it('rejects an empty transaction id', () => {
    const parsed = platformFinancialTransactionInputSchema.safeParse({
      platform: 'amazon',
      provider: 'amazon_finances',
      external_transaction_id: '',
      currency: 'EUR',
      gross_amount: '35.00',
      fee_amount: '5.25',
      net_amount: '29.75',
      posted_at: '2026-06-20T10:00:00.000Z'
    });

    expect(parsed.success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { marketingSpendBatchSchema, platformMarketingSpendInputSchema } from './platform-marketing-spend';

describe('platformMarketingSpendInputSchema', () => {
  it('normalizes numeric money inputs to decimal strings', () => {
    const parsed = platformMarketingSpendInputSchema.parse({
      platform: 'amazon',
      provider: 'amazon_ads',
      external_record_id: 'amazon_ads:spCampaigns:2026-06-01:123',
      report_type: 'spCampaigns',
      campaign_id: '123',
      campaign_name: 'Brand search',
      currency: 'EUR',
      spend_amount: 27.42,
      attributed_sales_amount: 145.5,
      purchases: '4',
      impressions: '1000',
      clicks: 25,
      date: '2026-06-01'
    });

    expect(parsed.spend_amount).toBe('27.42');
    expect(parsed.attributed_sales_amount).toBe('145.5');
    expect(parsed.purchases).toBe(4);
    expect(parsed.impressions).toBe(1000);
    expect(parsed.clicks).toBe(25);
  });

  it('accepts a batch payload with at least one record', () => {
    const parsed = marketingSpendBatchSchema.parse({
      records: [
        {
          platform: 'amazon',
          provider: 'amazon_ads',
          external_record_id: 'amazon_ads:spCampaigns:2026-06-01:123',
          currency: 'EUR',
          spend_amount: '27.42',
          date: '2026-06-01'
        }
      ]
    });

    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].attributed_sales_amount).toBe('0');
  });

  it('rejects an empty external record id', () => {
    const parsed = platformMarketingSpendInputSchema.safeParse({
      platform: 'amazon',
      provider: 'amazon_ads',
      external_record_id: '',
      currency: 'EUR',
      spend_amount: '27.42',
      date: '2026-06-01'
    });

    expect(parsed.success).toBe(false);
  });
});


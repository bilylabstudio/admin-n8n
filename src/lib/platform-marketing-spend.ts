import { z } from 'zod';
import { db } from './db';

const decimalString = z.union([z.number(), z.string()]).transform((value) => String(value));
const optionalInt = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((value) => {
    if (value === null || value === undefined || value === '') return 0;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  });

export const platformMarketingSpendInputSchema = z.object({
  platform: z.string().min(1),
  provider: z.string().min(1),
  external_record_id: z.string().min(1),
  report_type: z.string().optional().nullable(),
  campaign_id: z.string().optional().nullable(),
  campaign_name: z.string().optional().nullable(),
  currency: z.string().min(1),
  spend_amount: decimalString,
  attributed_sales_amount: decimalString.default('0'),
  purchases: optionalInt.default(0),
  impressions: optionalInt.default(0),
  clicks: optionalInt.default(0),
  date: z.string().min(1),
  raw_json: z.unknown().optional()
});

export const marketingSpendBatchSchema = z.object({
  records: z.array(platformMarketingSpendInputSchema).min(1)
});

export type PlatformMarketingSpendInput = z.infer<typeof platformMarketingSpendInputSchema>;

export async function upsertPlatformMarketingSpend(records: PlatformMarketingSpendInput[]) {
  const now = new Date();
  const results = await Promise.all(
    records.map((record) =>
      db.platformMarketingSpend.upsert({
        where: {
          provider_externalRecordId: {
            provider: record.provider,
            externalRecordId: record.external_record_id
          }
        },
        create: {
          platform: record.platform,
          provider: record.provider,
          externalRecordId: record.external_record_id,
          reportType: record.report_type ?? null,
          campaignId: record.campaign_id ?? null,
          campaignName: record.campaign_name ?? null,
          currency: record.currency,
          spendAmount: record.spend_amount,
          attributedSalesAmount: record.attributed_sales_amount,
          purchases: record.purchases,
          impressions: record.impressions,
          clicks: record.clicks,
          date: spendDate(record.date),
          rawJson: record.raw_json as never,
          syncedAt: now
        },
        update: {
          platform: record.platform,
          reportType: record.report_type ?? null,
          campaignId: record.campaign_id ?? null,
          campaignName: record.campaign_name ?? null,
          currency: record.currency,
          spendAmount: record.spend_amount,
          attributedSalesAmount: record.attributed_sales_amount,
          purchases: record.purchases,
          impressions: record.impressions,
          clicks: record.clicks,
          date: spendDate(record.date),
          rawJson: record.raw_json as never,
          syncedAt: now
        },
        select: {
          id: true,
          platform: true,
          provider: true,
          externalRecordId: true,
          date: true
        }
      })
    )
  );
  return results;
}

function spendDate(value: string): Date {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  return new Date(normalized);
}


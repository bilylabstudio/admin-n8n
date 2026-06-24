import { z } from 'zod';
import { db } from './db';

const decimalString = z.union([z.number(), z.string()]).transform((value) => String(value));

export const platformFinancialTransactionInputSchema = z.object({
  platform: z.string().min(1),
  provider: z.string().min(1),
  external_transaction_id: z.string().min(1),
  external_order_id: z.string().optional().nullable(),
  order_number: z.string().optional().nullable(),
  currency: z.string().min(1),
  gross_amount: decimalString,
  fee_amount: decimalString,
  net_amount: decimalString,
  transaction_type: z.string().optional().nullable(),
  transaction_status: z.string().optional().nullable(),
  posted_at: z.string().datetime(),
  raw_json: z.unknown().optional()
});

export const financialTransactionsBatchSchema = z.object({
  transactions: z.array(platformFinancialTransactionInputSchema).min(1)
});

export type PlatformFinancialTransactionInput = z.infer<typeof platformFinancialTransactionInputSchema>;

export async function upsertPlatformFinancialTransactions(transactions: PlatformFinancialTransactionInput[]) {
  const now = new Date();
  const results = await Promise.all(
    transactions.map((transaction) =>
      db.platformFinancialTransaction.upsert({
        where: {
          provider_externalTransactionId: {
            provider: transaction.provider,
            externalTransactionId: transaction.external_transaction_id
          }
        },
        create: {
          platform: transaction.platform,
          provider: transaction.provider,
          externalTransactionId: transaction.external_transaction_id,
          externalOrderId: transaction.external_order_id ?? null,
          orderNumber: transaction.order_number ?? null,
          currency: transaction.currency,
          grossAmount: transaction.gross_amount,
          feeAmount: transaction.fee_amount,
          netAmount: transaction.net_amount,
          transactionType: transaction.transaction_type ?? null,
          transactionStatus: transaction.transaction_status ?? null,
          postedAt: new Date(transaction.posted_at),
          rawJson: transaction.raw_json as never,
          syncedAt: now
        },
        update: {
          platform: transaction.platform,
          externalOrderId: transaction.external_order_id ?? null,
          orderNumber: transaction.order_number ?? null,
          currency: transaction.currency,
          grossAmount: transaction.gross_amount,
          feeAmount: transaction.fee_amount,
          netAmount: transaction.net_amount,
          transactionType: transaction.transaction_type ?? null,
          transactionStatus: transaction.transaction_status ?? null,
          postedAt: new Date(transaction.posted_at),
          rawJson: transaction.raw_json as never,
          syncedAt: now
        },
        select: {
          id: true,
          platform: true,
          provider: true,
          externalTransactionId: true,
          postedAt: true
        }
      })
    )
  );
  return results;
}

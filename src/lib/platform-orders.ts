import { z } from 'zod';
import { db } from './db';

const decimalString = z.union([z.number(), z.string()]).transform((v) => String(v));

export const platformOrderInputSchema = z.object({
  platform: z.string().min(1),
  external_order_id: z.string().min(1),
  order_number: z.string().optional().nullable(),
  currency: z.string().min(1),
  processed_at: z.string().datetime(),
  financial_status: z.string().min(1),
  fulfillment_status: z.string().optional().nullable(),
  cancelled_at: z.string().datetime().optional().nullable(),
  is_test: z.boolean().optional().default(false),
  subtotal: decimalString,
  total_tax: decimalString,
  total_shipping: decimalString,
  total_discounts: decimalString,
  total_price: decimalString,
  total_refunded: decimalString.optional().default('0'),
  total_units: z.number().int().nonnegative(),
  customer_email: z.string().optional().nullable(),
  country_code: z.string().optional().nullable(),
  channel: z.string().optional().nullable(),
  raw_json: z.unknown().optional(),
  external_updated_at: z.string().datetime()
});

export const ordersBatchSchema = z.object({
  orders: z.array(platformOrderInputSchema).min(1)
});

export type PlatformOrderInput = z.infer<typeof platformOrderInputSchema>;

export async function upsertPlatformOrders(orders: PlatformOrderInput[]) {
  const results = await Promise.all(
    orders.map((order) =>
      db.platformOrder.upsert({
        where: {
          platform_externalOrderId: {
            platform: order.platform,
            externalOrderId: order.external_order_id
          }
        },
        create: {
          platform: order.platform,
          externalOrderId: order.external_order_id,
          orderNumber: order.order_number ?? null,
          currency: order.currency,
          processedAt: new Date(order.processed_at),
          financialStatus: order.financial_status,
          fulfillmentStatus: order.fulfillment_status ?? null,
          cancelledAt: order.cancelled_at ? new Date(order.cancelled_at) : null,
          isTest: order.is_test,
          subtotal: order.subtotal,
          totalTax: order.total_tax,
          totalShipping: order.total_shipping,
          totalDiscounts: order.total_discounts,
          totalPrice: order.total_price,
          totalRefunded: order.total_refunded,
          totalUnits: order.total_units,
          customerEmail: order.customer_email ?? null,
          countryCode: order.country_code ?? null,
          channel: order.channel ?? null,
          rawJson: order.raw_json as never,
          externalUpdatedAt: new Date(order.external_updated_at),
          syncedAt: new Date()
        },
        update: {
          orderNumber: order.order_number ?? null,
          currency: order.currency,
          processedAt: new Date(order.processed_at),
          financialStatus: order.financial_status,
          fulfillmentStatus: order.fulfillment_status ?? null,
          cancelledAt: order.cancelled_at ? new Date(order.cancelled_at) : null,
          isTest: order.is_test,
          subtotal: order.subtotal,
          totalTax: order.total_tax,
          totalShipping: order.total_shipping,
          totalDiscounts: order.total_discounts,
          totalPrice: order.total_price,
          totalRefunded: order.total_refunded,
          totalUnits: order.total_units,
          customerEmail: order.customer_email ?? null,
          countryCode: order.country_code ?? null,
          channel: order.channel ?? null,
          rawJson: order.raw_json as never,
          externalUpdatedAt: new Date(order.external_updated_at),
          syncedAt: new Date()
        },
        select: { id: true, platform: true, externalOrderId: true, externalUpdatedAt: true }
      })
    )
  );
  return results;
}

export const syncStateInputSchema = z.object({
  platform: z.string().min(1),
  last_updated_at: z.string().datetime().optional().nullable(),
  last_sync_status: z.enum(['ok', 'failed']),
  last_sync_error: z.string().optional().nullable(),
  orders_imported: z.number().int().nonnegative().optional().default(0)
});

export type SyncStateInput = z.infer<typeof syncStateInputSchema>;

export async function markSyncState(input: SyncStateInput) {
  const lastUpdatedAt = input.last_updated_at ? new Date(input.last_updated_at) : undefined;

  return db.platformSyncState.upsert({
    where: { platform: input.platform },
    create: {
      platform: input.platform,
      lastUpdatedAt: lastUpdatedAt ?? null,
      lastSyncRunAt: new Date(),
      lastSyncStatus: input.last_sync_status,
      lastSyncError: input.last_sync_error ?? null,
      ordersImported: input.orders_imported
    },
    update: {
      ...(lastUpdatedAt ? { lastUpdatedAt } : {}),
      lastSyncRunAt: new Date(),
      lastSyncStatus: input.last_sync_status,
      lastSyncError: input.last_sync_error ?? null,
      ordersImported: input.orders_imported
    }
  });
}

const DEFAULT_BACKFILL_CURSOR = '2026-01-01T00:00:00.000Z';

export async function getSyncCursor(platform: string): Promise<string> {
  const state = await db.platformSyncState.findUnique({ where: { platform } });
  if (state?.lastUpdatedAt) return state.lastUpdatedAt.toISOString();
  return DEFAULT_BACKFILL_CURSOR;
}

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { PlatformOrderInput } from '../src/lib/platform-orders';

const DEFAULT_CREATED_AT_MIN = '2026-01-01T00:00:00.000Z';
const DEFAULT_CURSOR_PLATFORM = 'shopify_backfill_2026';
const SHOPIFY_LIMIT = 250;

type ShopifyTransaction = {
  kind?: string | null;
  status?: string | null;
  amount?: string | number | null;
};

type ShopifyRefund = {
  transactions?: ShopifyTransaction[] | null;
};

type ShopifyLineItem = {
  quantity?: number | null;
};

type ShopifyAddress = {
  country_code?: string | null;
};

type ShopifyOrder = {
  id?: string | number | null;
  name?: string | null;
  currency?: string | null;
  processed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
  test?: boolean | null;
  subtotal_price?: string | number | null;
  total_tax?: string | number | null;
  total_shipping_price_set?: {
    shop_money?: {
      amount?: string | number | null;
    } | null;
  } | null;
  total_discounts?: string | number | null;
  total_price?: string | number | null;
  refunds?: ShopifyRefund[] | null;
  line_items?: ShopifyLineItem[] | null;
  email?: string | null;
  contact_email?: string | null;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
  source_name?: string | null;
};

type ProxyOrdersResponse = {
  ok?: boolean;
  orders?: ShopifyOrder[];
  count?: number;
  error?: string;
};

type RuntimeConfig = {
  proxyWebhookUrl: string;
  proxySecret: string;
  cursorPlatform: string;
  createdAtMin: string;
  startSinceId?: string;
  maxPages: number;
  pageDelayMs: number;
  dbChunkSize: number;
  dryRun: boolean;
  includeRawJson: boolean;
};

function loadDotEnvFile(envPath: string) {
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadDotEnv() {
  loadDotEnvFile(resolve(process.cwd(), '.env'));
  loadDotEnvFile(resolve(process.cwd(), '..', '.env'));
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function optionalBool(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'si'].includes(raw);
}

function normalizeWebhookUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('N8N_SHOPIFY_ORDERS_PROXY_WEBHOOK_URL must be an http(s) URL');
  }
  return url.toString();
}

function readProxyWebhookUrl(): string {
  const explicit = process.env.N8N_SHOPIFY_ORDERS_PROXY_WEBHOOK_URL?.trim();
  if (explicit) return normalizeWebhookUrl(explicit);

  const base = (process.env.N8N_BASE_URL || process.env.N8N_URL)?.trim().replace(/\/+$/, '');
  if (base) return normalizeWebhookUrl(`${base}/webhook/shopify-orders-page`);

  throw new Error(
    'Missing required env var: N8N_SHOPIFY_ORDERS_PROXY_WEBHOOK_URL, N8N_BASE_URL, or N8N_URL'
  );
}

function readConfig(): RuntimeConfig {
  return {
    proxyWebhookUrl: readProxyWebhookUrl(),
    proxySecret:
      process.env.N8N_SHOPIFY_ORDERS_PROXY_SECRET?.trim() ||
      requiredEnv('N8N_SEND_APPROVED_SECRET'),
    cursorPlatform:
      process.env.SHOPIFY_BACKFILL_CURSOR_PLATFORM?.trim() || DEFAULT_CURSOR_PLATFORM,
    createdAtMin:
      process.env.SHOPIFY_BACKFILL_CREATED_AT_MIN?.trim() || DEFAULT_CREATED_AT_MIN,
    startSinceId: process.env.SHOPIFY_BACKFILL_START_SINCE_ID?.trim() || undefined,
    maxPages: optionalInt('SHOPIFY_BACKFILL_MAX_PAGES', 0),
    pageDelayMs: optionalInt('SHOPIFY_BACKFILL_PAGE_DELAY_MS', 600),
    dbChunkSize: optionalInt('SHOPIFY_BACKFILL_DB_CHUNK_SIZE', 50) || 50,
    dryRun: optionalBool('SHOPIFY_BACKFILL_DRY_RUN'),
    includeRawJson: optionalBool('SHOPIFY_BACKFILL_INCLUDE_RAW_JSON')
  };
}

function toUtc(value: string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function asMoney(value: string | number | null | undefined): string {
  return String(value ?? 0);
}

function mapOrder(order: ShopifyOrder, includeRawJson: boolean): PlatformOrderInput {
  if (!order.id) throw new Error('Shopify order missing id');

  const totalUnits = (order.line_items || []).reduce(
    (sum, lineItem) => sum + (lineItem.quantity || 0),
    0
  );
  const totalRefunded = (order.refunds || [])
    .flatMap((refund) => refund.transactions || [])
    .filter((transaction) => transaction.kind === 'refund' && transaction.status === 'success')
    .reduce((sum, transaction) => sum + Number.parseFloat(String(transaction.amount || 0)), 0);

  const processedAt = toUtc(order.processed_at || order.created_at);
  const externalUpdatedAt = toUtc(order.updated_at || order.processed_at || order.created_at);
  if (!processedAt || !externalUpdatedAt) {
    throw new Error(`Shopify order ${order.id} is missing date fields`);
  }

  return {
    platform: 'shopify',
    external_order_id: String(order.id),
    order_number: order.name || null,
    currency: order.currency || 'EUR',
    processed_at: processedAt,
    financial_status: order.financial_status || 'pending',
    fulfillment_status: order.fulfillment_status || null,
    cancelled_at: toUtc(order.cancelled_at),
    is_test: !!order.test,
    subtotal: asMoney(order.subtotal_price),
    total_tax: asMoney(order.total_tax),
    total_shipping: asMoney(order.total_shipping_price_set?.shop_money?.amount),
    total_discounts: asMoney(order.total_discounts),
    total_price: asMoney(order.total_price),
    total_refunded: String(totalRefunded),
    total_units: totalUnits,
    customer_email: order.email || order.contact_email || null,
    country_code: order.shipping_address?.country_code || order.billing_address?.country_code || null,
    channel: order.source_name || null,
    ...(includeRawJson ? { raw_json: order } : {}),
    external_updated_at: externalUpdatedAt
  };
}

function maxShopifyId(current: string, orders: PlatformOrderInput[]): string {
  let maxId = current || '0';
  for (const order of orders) {
    if (BigInt(order.external_order_id) > BigInt(maxId)) maxId = order.external_order_id;
  }
  return maxId;
}

function maxUpdatedAt(current: string, orders: PlatformOrderInput[]): string {
  let max = current;
  for (const order of orders) {
    if (order.external_updated_at > max) max = order.external_updated_at;
  }
  return max;
}

function retryAfterMs(response: Response, fallbackMs: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return fallbackMs;
  const seconds = Number.parseFloat(retryAfter);
  return Number.isFinite(seconds) ? Math.max(1000, seconds * 1000) : fallbackMs;
}

async function fetchOrdersPage(
  config: RuntimeConfig,
  sinceId: string
): Promise<ShopifyOrder[]> {
  let delayMs = 2000;

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(config.proxyWebhookUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Review-Admin-Token': config.proxySecret
      },
      body: JSON.stringify({
        since_id: sinceId,
        created_at_min: config.createdAtMin,
        limit: SHOPIFY_LIMIT
      })
    });

    if (response.ok) {
      const body = (await response.json()) as ProxyOrdersResponse;
      if (!body.ok) {
        throw new Error(`n8n proxy returned ok=false: ${body.error || 'unknown_error'}`);
      }
      return Array.isArray(body.orders) ? body.orders : [];
    }

    if (response.status === 429 || response.status >= 500) {
      const waitMs = response.status === 429 ? retryAfterMs(response, delayMs) : delayMs;
      console.warn(
        `n8n proxy ${response.status} en intento ${attempt}/6. Reintentando en ${waitMs} ms.`
      );
      await sleep(waitMs);
      delayMs = Math.min(delayMs * 2, 30_000);
      continue;
    }

    const body = await response.text().catch(() => '');
    throw new Error(`n8n proxy request failed ${response.status}: ${body.slice(0, 600)}`);
  }

  throw new Error('n8n proxy request failed after retries');
}

async function upsertInChunks(
  orders: PlatformOrderInput[],
  chunkSize: number,
  upsertPlatformOrders: (orders: PlatformOrderInput[]) => Promise<unknown[]>
) {
  let processed = 0;
  for (let index = 0; index < orders.length; index += chunkSize) {
    const chunk = orders.slice(index, index + chunkSize);
    processed += (await upsertPlatformOrders(chunk)).length;
  }
  return processed;
}

async function main() {
  loadDotEnv();

  let config: RuntimeConfig | undefined;
  let disconnectDb: (() => Promise<void>) | undefined;
  let markFailed:
    | ((input: {
        platform: string;
        last_updated_at: string;
        last_external_id: string;
        last_sync_status: 'failed';
        last_sync_error: string;
        orders_imported: number;
      }) => Promise<unknown>)
    | undefined;
  let sinceId = '0';
  let lastUpdatedAt = DEFAULT_CREATED_AT_MIN;
  let totalImported = 0;
  let page = 0;

  try {
    const runtimeConfig = readConfig();
    config = runtimeConfig;
    const { db } = await import('../src/lib/db');
    const { getSyncCursor, markSyncState, upsertPlatformOrders } = await import(
      '../src/lib/platform-orders'
    );
    disconnectDb = () => db.$disconnect();
    markFailed = markSyncState;

    lastUpdatedAt = runtimeConfig.createdAtMin;

    const cursor = await getSyncCursor(runtimeConfig.cursorPlatform);
    sinceId =
      runtimeConfig.startSinceId !== undefined
        ? runtimeConfig.startSinceId
        : cursor.since_id || '0';
    lastUpdatedAt = cursor.cursor || runtimeConfig.createdAtMin;

    console.log('Backfill Shopify 2026 iniciado via n8n proxy.');
    console.log(`Webhook n8n: ${runtimeConfig.proxyWebhookUrl}`);
    console.log(`Cursor platform: ${runtimeConfig.cursorPlatform}`);
    console.log(`created_at_min: ${runtimeConfig.createdAtMin}`);
    console.log(`since_id inicial: ${sinceId}`);
    console.log(`modo: ${runtimeConfig.dryRun ? 'DRY RUN' : 'escritura real'}`);

    while (runtimeConfig.maxPages === 0 || page < runtimeConfig.maxPages) {
      page += 1;
      const rawOrders = await fetchOrdersPage(runtimeConfig, sinceId);
      const orders = rawOrders.map((order) => mapOrder(order, runtimeConfig.includeRawJson));

      if (orders.length === 0) {
        console.log(`Pagina ${page}: n8n/Shopify devolvio 0 pedidos. Backfill completado.`);
        break;
      }

      const nextSinceId = maxShopifyId(sinceId, orders);
      if (sinceId !== '0' && BigInt(nextSinceId) <= BigInt(sinceId)) {
        throw new Error(
          `pagination_not_advancing: since_id=${sinceId}, next_since_id=${nextSinceId}. ` +
            'El proxy devolvio una pagina repetida; detuve el backfill para evitar upserts duplicados.'
        );
      }

      lastUpdatedAt = maxUpdatedAt(lastUpdatedAt, orders);

      if (!runtimeConfig.dryRun) {
        const processed = await upsertInChunks(
          orders,
          runtimeConfig.dbChunkSize,
          upsertPlatformOrders
        );
        await markSyncState({
          platform: runtimeConfig.cursorPlatform,
          last_updated_at: lastUpdatedAt,
          last_external_id: nextSinceId,
          last_sync_status: 'ok',
          orders_imported: processed
        });
      }

      totalImported += orders.length;
      sinceId = nextSinceId;

      console.log(
        [
          `Pagina ${page}`,
          `pedidos ${orders.length}`,
          `total corrida ${totalImported}`,
          `last_since_id ${sinceId}`,
          runtimeConfig.dryRun ? 'dry-run sin guardar' : 'guardado'
        ].join(' | ')
      );

      if (orders.length < SHOPIFY_LIMIT) {
        console.log('Ultima pagina detectada: Shopify devolvio menos de 250 pedidos.');
        break;
      }

      if (runtimeConfig.pageDelayMs > 0) await sleep(runtimeConfig.pageDelayMs);
    }

    if (runtimeConfig.maxPages > 0 && page >= runtimeConfig.maxPages) {
      console.log(
        `Limite SHOPIFY_BACKFILL_MAX_PAGES=${runtimeConfig.maxPages} alcanzado. ` +
          'Puedes ejecutar el script otra vez para continuar desde el cursor.'
      );
    }

    console.log(
      `Backfill finalizado. paginas=${page}, total_corrida=${totalImported}, last_since_id=${sinceId}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Backfill fallido: ${message}`);

    if (config && markFailed && !config.dryRun) {
      await markFailed({
        platform: config.cursorPlatform,
        last_updated_at: lastUpdatedAt,
        last_external_id: sinceId || '0',
        last_sync_status: 'failed',
        last_sync_error: message.slice(0, 1000),
        orders_imported: totalImported
      }).catch((stateError) => {
        console.error(
          `No se pudo guardar estado failed: ${
            stateError instanceof Error ? stateError.message : String(stateError)
          }`
        );
      });
    }

    process.exitCode = 1;
  } finally {
    await disconnectDb?.();
  }
}

main();

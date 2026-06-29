import type { LiveOrderFetcher, PlatformOrderRow } from './customer-profile';

// Cliente del endpoint n8n de lookup de pedidos Shopify EN VIVO.
//
// review-admin NO tiene credenciales de Shopify (por diseno): la consulta en vivo
// se hace via un webhook n8n ("Shopify - Pedidos Lookup") que tiene la credencial
// OAuth2 y consulta el Admin API por nombre de pedido y/o email. Lo usan casos de
// suscripcion, envio/seguimiento y promo cuando la BD sincronizada aun no alcanza.
// Este cliente es fail-open: cualquier fallo de config/red/timeout devuelve [] y el
// llamador conserva el contexto de la BD sincronizada.

const LOOKUP_URL =
  process.env.N8N_SHOPIFY_ORDER_LOOKUP_WEBHOOK_URL ||
  process.env.N8N_SHOPIFY_LOOKUP_WEBHOOK_URL ||
  '';
const LOOKUP_SECRET =
  process.env.N8N_SHOPIFY_ORDER_LOOKUP_SECRET ||
  process.env.N8N_SHOPIFY_ORDERS_PROXY_SECRET ||
  '';
const LOOKUP_TIMEOUT_MS = Number.parseInt(process.env.N8N_SHOPIFY_LOOKUP_TIMEOUT_MS || '2500', 10) || 2500;
const MAX_ORDER_NAMES = 5;

type RawShopifyOrder = {
  id?: string | number | null;
  name?: string | null;
  currency?: string | null;
  processed_at?: string | null;
  created_at?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
  test?: boolean | null;
  total_price?: string | number | null;
  email?: string | null;
  contact_email?: string | null;
  source_name?: string | null;
  [key: string]: unknown;
};

type LookupResponse = {
  ok?: boolean;
  orders?: RawShopifyOrder[];
  error?: string;
};

export const fetchLiveSubscriptionOrders: LiveOrderFetcher = async ({ email, orderNumbers }) => {
  if (!LOOKUP_URL || !LOOKUP_SECRET) return [];
  if (!email && orderNumbers.length === 0) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(LOOKUP_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-review-admin-token': LOOKUP_SECRET
      },
      body: JSON.stringify({
        email: email || '',
        order_names: orderNumbers.slice(0, MAX_ORDER_NAMES)
      }),
      signal: controller.signal
    });
    if (!response.ok) return [];
    const json = (await response.json()) as LookupResponse;
    if (!json || json.ok === false || !Array.isArray(json.orders)) return [];
    return json.orders.map(rawOrderToRow).filter((row): row is PlatformOrderRow => row !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
};

function rawOrderToRow(order: RawShopifyOrder): PlatformOrderRow | null {
  if (!order || order.id == null) return null;
  const processedRaw = order.processed_at || order.created_at;
  const processedAt = processedRaw ? new Date(processedRaw) : new Date(NaN);
  if (Number.isNaN(processedAt.getTime())) return null;

  return {
    id: `shopify:${order.id}`,
    platform: 'shopify',
    orderNumber: order.name ?? null,
    externalOrderId: String(order.id),
    processedAt,
    totalPrice: order.total_price ?? '0',
    currency: order.currency || 'EUR',
    financialStatus: order.financial_status || 'pending',
    fulfillmentStatus: order.fulfillment_status ?? null,
    cancelledAt: order.cancelled_at ? new Date(order.cancelled_at) : null,
    channel: order.source_name ?? null,
    // El JSON completo del pedido permite que getSubscriptionEvidence detecte la
    // suscripcion via source_name / line_items[].selling_plan_allocation / recarga.
    rawJson: order,
    isTest: Boolean(order.test)
  };
}

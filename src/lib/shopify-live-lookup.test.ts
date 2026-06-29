import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('fetchLiveSubscriptionOrders', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses N8N_SHOPIFY_ORDER_LOOKUP_WEBHOOK_URL for the point lookup endpoint', async () => {
    vi.stubEnv('N8N_SHOPIFY_ORDER_LOOKUP_WEBHOOK_URL', 'https://n8n.example/webhook/shopify-order-lookup');
    vi.stubEnv('N8N_SHOPIFY_ORDER_LOOKUP_SECRET', 'lookup-secret');
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        orders: [
          {
            id: 9001,
            name: '#9001',
            processed_at: '2026-06-26T08:30:00.000Z',
            total_price: '49.90',
            currency: 'EUR',
            financial_status: 'paid',
            fulfillment_status: 'fulfilled',
            source_name: 'web'
          }
        ]
      })
    );

    const { fetchLiveSubscriptionOrders } = await import('./shopify-live-lookup');
    const rows = await fetchLiveSubscriptionOrders({
      email: 'cliente@example.com',
      orderNumbers: ['9001'],
      referenceDate: new Date('2026-06-26T10:12:00.000Z')
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://n8n.example/webhook/shopify-order-lookup',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-review-admin-token': 'lookup-secret'
        }),
        body: JSON.stringify({
          email: 'cliente@example.com',
          order_names: ['9001']
        })
      })
    );
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'shopify:9001',
        orderNumber: '#9001',
        fulfillmentStatus: 'fulfilled'
      })
    ]);
  });

  it('is fail-open when the point lookup endpoint is not configured', async () => {
    vi.stubEnv('N8N_SHOPIFY_ORDER_LOOKUP_WEBHOOK_URL', '');
    vi.stubEnv('N8N_SHOPIFY_LOOKUP_WEBHOOK_URL', '');
    vi.stubEnv('N8N_SHOPIFY_ORDER_LOOKUP_SECRET', '');
    vi.stubEnv('N8N_SHOPIFY_ORDERS_PROXY_SECRET', '');

    const { fetchLiveSubscriptionOrders } = await import('./shopify-live-lookup');
    const rows = await fetchLiveSubscriptionOrders({
      email: 'cliente@example.com',
      orderNumbers: [],
      referenceDate: new Date('2026-06-26T10:12:00.000Z')
    });

    expect(rows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const count = vi.fn();
const findMany = vi.fn();

vi.mock('./db', () => ({
  db: {
    platformOrder: {
      count,
      findMany
    }
  }
}));

const NO_RELEVANT_SUBSCRIPTION_CONTEXT = {
  hasRelevantSubscriptionOrder: false,
  state: 'not_generated_detected',
  matchType: 'none',
  generatedLookbackDays: 7,
  receivedLookbackDays: 30,
  latestSubscriptionOrder: null,
  ignoredSubscriptionOrders: []
};

const EMPTY_PROMO_CONTEXT = {
  matched: false,
  matchType: 'none',
  boughtPromo3x2: false,
  unitsOrdered: 0,
  promoDiscountTotal: 0,
  orderNumber: null,
  fulfillmentStatus: null,
  processedAt: null
};

function shopifyOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    platform: 'shopify',
    orderNumber: '#1001',
    externalOrderId: '1001',
    processedAt: new Date('2026-06-04T10:00:00.000Z'),
    totalPrice: '49.90',
    currency: 'EUR',
    financialStatus: 'paid',
    fulfillmentStatus: 'fulfilled',
    cancelledAt: null,
    channel: null,
    rawJson: {},
    isTest: false,
    ...overrides
  };
}

function expectedOrderSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    platform: 'shopify',
    orderNumber: '#1001',
    processedAt: '2026-06-04T10:00:00.000Z',
    totalPrice: '49.90',
    currency: 'EUR',
    financialStatus: 'paid',
    fulfillmentStatus: 'fulfilled',
    cancelledAt: null,
    channel: null,
    isSubscriptionOrder: false,
    subscriptionEvidence: [],
    ...overrides
  };
}

describe('extractOrderNumberCandidates', () => {
  it('extracts hash-prefixed order numbers', async () => {
    const { extractOrderNumberCandidates } = await import('./customer-profile');

    expect(
      extractOrderNumberCandidates([
        'Hola soy Isabel y he realizado el pedido #45405 y necesito modificar la direccion.'
      ])
    ).toEqual(['45405']);
  });

  it('extracts numbers near order words', async () => {
    const { extractOrderNumberCandidates } = await import('./customer-profile');

    expect(
      extractOrderNumberCandidates([
        'Necesito revisar pedido 45405',
        'La orden 99881 no aparece',
        'My order 77777 has a problem',
        'Compra 11223 pendiente'
      ])
    ).toEqual(['45405', '99881', '77777', '11223']);
  });

  it('does not extract address, postal code, or short numbers without order context', async () => {
    const { extractOrderNumberCandidates } = await import('./customer-profile');

    expect(
      extractOrderNumberCandidates([
        'Nueva direccion Calle Valle de Zuriza numero 20, 3B, 50015 Zaragoza'
      ])
    ).toEqual([]);
  });

  it('dedupes candidates and strips punctuation', async () => {
    const { extractOrderNumberCandidates } = await import('./customer-profile');

    expect(
      extractOrderNumberCandidates(['Pedido #45405.', 'pedido 45405', 'orden: #45405'])
    ).toEqual(['45405']);
  });
});

describe('getCustomerProfileByEmail', () => {
  beforeEach(() => {
    count.mockReset();
    findMany.mockReset();
  });

  it('returns an empty profile and skips db calls when email is blank', async () => {
    const { getCustomerProfileByEmail } = await import('./customer-profile');

    await expect(getCustomerProfileByEmail('   ')).resolves.toEqual({
      email: '',
      orderCount: 0,
      recentOrders: [],
      subscriptionOrderContext: NO_RELEVANT_SUBSCRIPTION_CONTEXT,
      promoOrderContext: EMPTY_PROMO_CONTEXT
    });
    expect(count).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('normalizes email and returns recent orders', async () => {
    const { getCustomerProfileByEmail } = await import('./customer-profile');
    count.mockResolvedValue(6);
    findMany.mockResolvedValue([shopifyOrder({ id: 'order-1', orderNumber: '#1006', externalOrderId: '1006' })]);

    await expect(getCustomerProfileByEmail(' Lola@Example.COM ')).resolves.toEqual({
      email: 'lola@example.com',
      orderCount: 1,
      recentOrders: [expectedOrderSummary({ id: 'order-1', orderNumber: '#1006' })],
      subscriptionOrderContext: NO_RELEVANT_SUBSCRIPTION_CONTEXT,
      promoOrderContext: expect.any(Object)
    });

    expect(count).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          customerEmail: {
            equals: 'lola@example.com',
            mode: 'insensitive'
          }
        },
        orderBy: { processedAt: 'desc' },
        take: 25,
        select: {
          id: true,
          platform: true,
          orderNumber: true,
          externalOrderId: true,
          processedAt: true,
          totalPrice: true,
          currency: true,
          financialStatus: true,
          fulfillmentStatus: true,
          cancelledAt: true,
          channel: true,
          rawJson: true,
          isTest: true
        }
      })
    );
  });

  it('finds an order by number when the email does not match', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    count.mockResolvedValue(0);
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        shopifyOrder({
          id: 'order-by-number',
          orderNumber: '#45405',
          externalOrderId: 'gid-45405',
          processedAt: new Date('2026-06-05T09:00:00.000Z'),
          totalPrice: '59.90'
        })
      ]);

    await expect(
      getCustomerProfile({
        email: 'ticket-email@example.com',
        texts: ['Modificar direccion de envio', 'He realizado el pedido #45405']
      })
    ).resolves.toEqual({
      email: 'ticket-email@example.com',
      orderCount: 1,
      recentOrders: [
        expectedOrderSummary({
          id: 'order-by-number',
          orderNumber: '#45405',
          processedAt: '2026-06-05T09:00:00.000Z',
          totalPrice: '59.90'
        })
      ],
      subscriptionOrderContext: NO_RELEVANT_SUBSCRIPTION_CONTEXT,
      promoOrderContext: expect.objectContaining({
        matched: true,
        matchType: 'exact_order_number',
        boughtPromo3x2: false,
        orderNumber: '#45405'
      })
    });

    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          OR: [
            { orderNumber: { in: ['45405', '#45405'] } },
            { externalOrderId: { in: ['45405'] } }
          ]
        }
      })
    );
  });

  it('dedupes orders found by both email and number and prioritizes number matches', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    count.mockResolvedValue(2);
    const shared = shopifyOrder({
      id: 'shared-order',
      orderNumber: '#45405',
      externalOrderId: '45405',
      processedAt: new Date('2026-06-05T09:00:00.000Z'),
      totalPrice: '59.90'
    });
    findMany
      .mockResolvedValueOnce([
        shopifyOrder({
          id: 'email-order',
          orderNumber: '#1001',
          externalOrderId: '1001',
          processedAt: new Date('2026-06-01T09:00:00.000Z'),
          totalPrice: '29.90',
          fulfillmentStatus: null
        }),
        shared
      ])
      .mockResolvedValueOnce([shared]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['pedido #45405']
    });

    expect(profile.orderCount).toBe(2);
    expect(profile.recentOrders.map((order) => order.id)).toEqual([
      'shared-order',
      'email-order'
    ]);
  });

  it('keeps only five recent deduped orders', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    count.mockResolvedValue(6);
    findMany
      .mockResolvedValueOnce(
        Array.from({ length: 6 }, (_, index) =>
          shopifyOrder({
            id: `email-order-${index}`,
            orderNumber: `#10${index}`,
            externalOrderId: `10${index}`,
            processedAt: new Date(`2026-06-0${Math.min(index + 1, 9)}T09:00:00.000Z`),
            totalPrice: '10.00',
            fulfillmentStatus: null
          })
        )
      )
      .mockResolvedValueOnce([]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['pedido #99999']
    });

    expect(profile.orderCount).toBe(6);
    expect(profile.recentOrders).toHaveLength(5);
  });

  it('uses externalOrderId when orderNumber is missing', async () => {
    const { getCustomerProfileByEmail } = await import('./customer-profile');
    count.mockResolvedValue(1);
    findMany.mockResolvedValue([
      shopifyOrder({
        id: 'order-2',
        orderNumber: null,
        externalOrderId: '27215069513',
        processedAt: new Date('2026-06-02T08:30:00.000Z'),
        totalPrice: { toString: () => '29.95' },
        financialStatus: 'pending',
        fulfillmentStatus: null
      })
    ]);

    const profile = await getCustomerProfileByEmail('cliente@example.com');

    expect(profile.recentOrders[0].orderNumber).toBe('27215069513');
    expect(profile.recentOrders[0].totalPrice).toBe('29.95');
  });

  it('returns an empty profile when the order lookup fails', async () => {
    const { getCustomerProfileByEmail } = await import('./customer-profile');
    findMany.mockRejectedValue(new Error('database unavailable'));

    await expect(getCustomerProfileByEmail('cliente@example.com')).resolves.toEqual({
      email: 'cliente@example.com',
      orderCount: 0,
      recentOrders: [],
      subscriptionOrderContext: NO_RELEVANT_SUBSCRIPTION_CONTEXT,
      promoOrderContext: EMPTY_PROMO_CONTEXT
    });
  });

  it('ignores an old Loop order when the customer only has an upcoming subscription notice', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValueOnce([
      shopifyOrder({
        id: 'old-loop',
        orderNumber: '#40001',
        externalOrderId: '40001',
        processedAt: new Date('2026-05-16T09:00:00.000Z'),
        channel: 'Loop Subscriptions'
      })
    ]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['Tu proximo pedido llega pronto', 'No quiero mas productos'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    expect(profile.subscriptionOrderContext).toEqual({
      ...NO_RELEVANT_SUBSCRIPTION_CONTEXT,
      ignoredSubscriptionOrders: [
        {
          orderNumber: '#40001',
          processedAt: '2026-05-16T09:00:00.000Z',
          reason: 'too_old_for_current_message'
        }
      ]
    });
  });

  it('uses the exact Loop order number even when the order is old', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        shopifyOrder({
          id: 'exact-loop',
          orderNumber: '#50111',
          externalOrderId: '50111',
          processedAt: new Date('2026-05-16T09:00:00.000Z'),
          fulfillmentStatus: null,
          channel: 'Loop Subscriptions'
        })
      ]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['Quiero anular el pedido #50111'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    expect(profile.subscriptionOrderContext).toEqual(
      expect.objectContaining({
        hasRelevantSubscriptionOrder: true,
        state: 'generated_not_shipped',
        matchType: 'exact_order_number',
        latestSubscriptionOrder: expect.objectContaining({
          id: 'exact-loop',
          orderNumber: '#50111',
          isSubscriptionOrder: true,
          subscriptionEvidence: ['channel_subscription']
        })
      })
    );
  });

  it('uses the latest recent Loop order when there is no order number', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValueOnce([
      shopifyOrder({
        id: 'recent-loop',
        orderNumber: '#50112',
        externalOrderId: '50112',
        processedAt: new Date('2026-06-22T09:00:00.000Z'),
        fulfillmentStatus: null,
        channel: 'Loop Subscriptions'
      })
    ]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['No reconozco este pedido de suscripcion'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    expect(profile.subscriptionOrderContext).toEqual(
      expect.objectContaining({
        hasRelevantSubscriptionOrder: true,
        state: 'generated_not_shipped',
        matchType: 'recent_generated',
        latestSubscriptionOrder: expect.objectContaining({ id: 'recent-loop' })
      })
    );
  });

  it('allows a wider received/devolution window for an old Loop order', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValueOnce([
      shopifyOrder({
        id: 'received-loop',
        orderNumber: '#50113',
        externalOrderId: '50113',
        processedAt: new Date('2026-06-05T09:00:00.000Z'),
        fulfillmentStatus: 'fulfilled',
        channel: 'Loop Subscriptions'
      })
    ]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['Ya lo he recibido y quiero devolverlo'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    expect(profile.subscriptionOrderContext).toEqual(
      expect.objectContaining({
        hasRelevantSubscriptionOrder: true,
        state: 'generated_processed',
        matchType: 'received_window',
        latestSubscriptionOrder: expect.objectContaining({ id: 'received-loop' })
      })
    );
  });

  it('marks charge claims without a relevant Loop order as unknown for safe review', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValueOnce([
      shopifyOrder({
        id: 'old-loop-charge',
        orderNumber: '#50114',
        externalOrderId: '50114',
        processedAt: new Date('2026-05-16T09:00:00.000Z'),
        channel: 'Loop Subscriptions'
      })
    ]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['Me han cobrado una suscripcion que no reconozco'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    expect(profile.subscriptionOrderContext).toEqual(
      expect.objectContaining({
        hasRelevantSubscriptionOrder: false,
        state: 'unknown_charge_no_order',
        matchType: 'none',
        latestSubscriptionOrder: null,
        ignoredSubscriptionOrders: [
          {
            orderNumber: '#50114',
            processedAt: '2026-05-16T09:00:00.000Z',
            reason: 'too_old_for_current_message'
          }
        ]
      })
    );
  });
});

// Cobertura de la deteccion de "es de suscripcion" (Riesgo 2 del plan): el estado
// generated_* solo se aplica si getSubscriptionEvidence reconoce el pedido como de
// suscripcion. Estas pruebas fijan el contrato del que depende el flujo de n8n.
describe('subscription order evidence', () => {
  beforeEach(() => {
    count.mockReset();
    findMany.mockReset();
  });

  it('detects a Loop renewal via line item selling_plan (no channel)', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValueOnce([
      shopifyOrder({
        id: 'sp-loop',
        orderNumber: '#50120',
        externalOrderId: '50120',
        processedAt: new Date('2026-06-23T09:00:00.000Z'),
        fulfillmentStatus: null,
        channel: null,
        rawJson: {
          line_items: [
            { title: 'V-Gummies | Gominolas Vinagre de Manzana', selling_plan_allocation: { selling_plan: { id: 7 } } }
          ]
        }
      })
    ]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['No reconozco este pedido, no he vuelto a pedir nada'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    expect(profile.subscriptionOrderContext).toEqual(
      expect.objectContaining({
        hasRelevantSubscriptionOrder: true,
        state: 'generated_not_shipped',
        matchType: 'recent_generated'
      })
    );
    expect(profile.subscriptionOrderContext.latestSubscriptionOrder?.subscriptionEvidence).toContain(
      'line_item_selling_plan'
    );
  });

  it('detects a subscription order via line item text (recarga cada N dias)', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValueOnce([
      shopifyOrder({
        id: 'text-loop',
        orderNumber: '#50121',
        externalOrderId: '50121',
        processedAt: new Date('2026-06-24T09:00:00.000Z'),
        fulfillmentStatus: 'fulfilled',
        channel: null,
        rawJson: {
          source_name: 'web',
          line_items: [{ name: 'V-Gummies Recarga cada 24 dias', sku: 'DTOX-1' }]
        }
      })
    ]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['Ya lo recibi y quiero devolverlo'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    expect(profile.subscriptionOrderContext.state).toBe('generated_processed');
    expect(profile.subscriptionOrderContext.latestSubscriptionOrder?.subscriptionEvidence).toContain(
      'line_item_subscription_text'
    );
  });

  it('detects a subscription order via source_name (loop)', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValueOnce([
      shopifyOrder({
        id: 'srcname-loop',
        orderNumber: '#50122',
        externalOrderId: '50122',
        processedAt: new Date('2026-06-23T09:00:00.000Z'),
        fulfillmentStatus: null,
        channel: null,
        rawJson: { source_name: 'loop_subscriptions', line_items: [{ name: 'V-Gummies' }] }
      })
    ]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['No quiero esta suscripcion, devolvedme el dinero'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    expect(profile.subscriptionOrderContext.state).toBe('generated_not_shipped');
    expect(profile.subscriptionOrderContext.latestSubscriptionOrder?.subscriptionEvidence).toContain(
      'source_name_subscription'
    );
  });

  it('does NOT treat a recent NON-subscription order as a relevant subscription order', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValueOnce([
      shopifyOrder({
        id: 'plain-order',
        orderNumber: '#50123',
        externalOrderId: '50123',
        processedAt: new Date('2026-06-24T09:00:00.000Z'),
        fulfillmentStatus: null,
        channel: 'Tienda online',
        rawJson: { source_name: 'web', line_items: [{ name: 'V-Gummies | Pack 1x', sku: 'DTOX-1' }] }
      })
    ]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['Quiero cancelar la suscripcion'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    // Sin evidencia de suscripcion, el pedido reciente no convierte el caso en generated_*.
    expect(profile.subscriptionOrderContext.hasRelevantSubscriptionOrder).toBe(false);
    expect(profile.subscriptionOrderContext.state).toBe('not_generated_detected');
  });
});

// Cobertura del promoOrderContext (incidencia 3x2 / pedido incompleto): distingue
// si la clienta compro la promo (entitled a la 3a bolsa -> error de almacen) o
// unidades sueltas (error del cliente -> oficina envia la extra).
describe('promo order context (3x2)', () => {
  beforeEach(() => {
    count.mockReset();
    findMany.mockReset();
  });

  it('flags boughtPromo3x2 for the AHORRA 3X2 bundle variant (#DTOX-3)', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValue([
      shopifyOrder({
        id: 'promo-bundle',
        orderNumber: '#51142',
        externalOrderId: '51142',
        processedAt: new Date('2026-06-24T09:00:00.000Z'),
        rawJson: {
          line_items: [
            {
              title: 'V-Gummies | Gominolas Vinagre de Manzana',
              variant_title: 'AHORRA 3X2',
              sku: '#DTOX-3',
              quantity: 1,
              price: '49.95',
              discount_allocations: [{ amount: '13.64' }]
            }
          ]
        }
      })
    ]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['pedi el 3x2 y solo me llegaron dos bolsas, pedido #51142'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    expect(profile.promoOrderContext).toEqual(
      expect.objectContaining({
        matched: true,
        matchType: 'exact_order_number',
        boughtPromo3x2: true,
        orderNumber: '#51142'
      })
    );
  });

  it('flags boughtPromo3x2 for 3x PACK 1X with a promo discount (paga 2, lleva 3)', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValue([
      shopifyOrder({
        id: 'promo-singles',
        orderNumber: '#51139',
        externalOrderId: '51139',
        processedAt: new Date('2026-06-24T09:00:00.000Z'),
        rawJson: {
          line_items: [
            { variant_title: 'PACK 1X', sku: '#DTOX-1', quantity: 1, price: '24.99', discount_allocations: [{ amount: '24.99' }] },
            { variant_title: 'PACK 1X', sku: '#DTOX-1', quantity: 2, price: '24.99', discount_allocations: [{ amount: '0.00' }] }
          ]
        }
      })
    ]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['solo me llegaron dos del 3x2, pedido #51139'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    expect(profile.promoOrderContext).toEqual(
      expect.objectContaining({ matched: true, boughtPromo3x2: true, unitsOrdered: 3, promoDiscountTotal: 24.99 })
    );
  });

  it('does NOT flag the promo for individual units at full price (error del cliente)', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValue([
      shopifyOrder({
        id: 'singles-only',
        orderNumber: '#51138',
        externalOrderId: '51138',
        processedAt: new Date('2026-06-24T09:00:00.000Z'),
        rawJson: {
          line_items: [
            { variant_title: 'PACK 1X', sku: '#DTOX-1', quantity: 2, price: '24.99', discount_allocations: [] }
          ]
        }
      })
    ]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['pedi el 3x2 y solo me llegaron dos, pedido #51138'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    expect(profile.promoOrderContext).toEqual(
      expect.objectContaining({ matched: true, boughtPromo3x2: false, unitsOrdered: 2, promoDiscountTotal: 0 })
    );
  });

  it('returns matched=false when the order cannot be found', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValue([]);

    const profile = await getCustomerProfile({
      email: 'cliente@example.com',
      texts: ['pedi el 3x2 y solo me llegaron dos'],
      referenceDate: '2026-06-25T12:00:00.000Z'
    });

    expect(profile.promoOrderContext.matched).toBe(false);
    expect(profile.promoOrderContext.boughtPromo3x2).toBe(false);
  });
});

describe('getCustomerProfile live order fallback', () => {
  beforeEach(() => {
    count.mockReset();
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it('uses the live fetcher when the synced DB has no relevant subscription order (caso raul)', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValue([]); // BD sincronizada todavia sin el pedido

    const liveOrderFetcher = vi.fn().mockResolvedValue([
      shopifyOrder({
        id: 'shopify:49912',
        orderNumber: '#49912',
        externalOrderId: '49912',
        processedAt: new Date('2026-06-24T08:47:00.000Z'),
        financialStatus: 'paid',
        fulfillmentStatus: null,
        channel: 'Loop Subscriptions',
        rawJson: {
          source_name: 'Loop Subscriptions',
          line_items: [{ name: 'V-Gummies', selling_plan_allocation: { selling_plan: { id: 1 } } }]
        }
      })
    ]);

    const profile = await getCustomerProfile(
      {
        email: 'meneses.raul@hotmail.com',
        texts: ['Re: Confirmacion de pedido #49912', 'nosotros no hemos hecho ningun pedido'],
        referenceDate: '2026-06-28T15:25:00.000Z'
      },
      { liveOrderFetcher }
    );

    expect(liveOrderFetcher).toHaveBeenCalledOnce();
    expect(profile.subscriptionOrderContext.hasRelevantSubscriptionOrder).toBe(true);
    expect(profile.subscriptionOrderContext.state).toBe('generated_not_shipped');
  });

  it('is fail-open: a throwing live fetcher keeps the DB context', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValue([]);
    const liveOrderFetcher = vi.fn().mockRejectedValue(new Error('timeout'));

    const profile = await getCustomerProfile(
      { email: 'cliente@example.com', texts: ['quiero darme de baja'], referenceDate: '2026-06-28T15:25:00.000Z' },
      { liveOrderFetcher }
    );

    expect(liveOrderFetcher).toHaveBeenCalledOnce();
    expect(profile.subscriptionOrderContext.hasRelevantSubscriptionOrder).toBe(false);
  });

  it('does NOT call the live fetcher when the DB already has a relevant subscription order', async () => {
    const { getCustomerProfile } = await import('./customer-profile');
    findMany.mockResolvedValue([
      shopifyOrder({
        id: 'db-1',
        orderNumber: '#49912',
        externalOrderId: '49912',
        processedAt: new Date('2026-06-24T08:47:00.000Z'),
        fulfillmentStatus: null,
        channel: 'Loop Subscriptions',
        rawJson: { source_name: 'Loop Subscriptions' }
      })
    ]);
    const liveOrderFetcher = vi.fn().mockResolvedValue([]);

    const profile = await getCustomerProfile(
      { email: 'cliente@example.com', texts: ['#49912 no lo reconozco'], referenceDate: '2026-06-28T15:25:00.000Z' },
      { liveOrderFetcher }
    );

    expect(liveOrderFetcher).not.toHaveBeenCalled();
    expect(profile.subscriptionOrderContext.hasRelevantSubscriptionOrder).toBe(true);
  });
});

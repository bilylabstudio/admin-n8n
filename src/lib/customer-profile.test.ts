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
      recentOrders: []
    });
    expect(count).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('normalizes email and returns recent orders', async () => {
    const { getCustomerProfileByEmail } = await import('./customer-profile');
    count.mockResolvedValue(6);
    findMany.mockResolvedValue([
      {
        id: 'order-1',
        platform: 'shopify',
        orderNumber: '#1006',
        externalOrderId: '1006',
        processedAt: new Date('2026-06-04T10:00:00.000Z'),
        totalPrice: '49.90',
        currency: 'EUR',
        financialStatus: 'paid',
        fulfillmentStatus: 'fulfilled',
        cancelledAt: null
      }
    ]);

    await expect(getCustomerProfileByEmail(' Lola@Example.COM ')).resolves.toEqual({
      email: 'lola@example.com',
      orderCount: 1,
      recentOrders: [
        {
          id: 'order-1',
          platform: 'shopify',
          orderNumber: '#1006',
          processedAt: '2026-06-04T10:00:00.000Z',
          totalPrice: '49.90',
          currency: 'EUR',
          financialStatus: 'paid',
          fulfillmentStatus: 'fulfilled',
          cancelledAt: null
        }
      ]
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
          cancelledAt: true
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
        {
          id: 'order-by-number',
          platform: 'shopify',
          orderNumber: '#45405',
          externalOrderId: 'gid-45405',
          processedAt: new Date('2026-06-05T09:00:00.000Z'),
          totalPrice: '59.90',
          currency: 'EUR',
          financialStatus: 'paid',
          fulfillmentStatus: 'fulfilled',
          cancelledAt: null
        }
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
        {
          id: 'order-by-number',
          platform: 'shopify',
          orderNumber: '#45405',
          processedAt: '2026-06-05T09:00:00.000Z',
          totalPrice: '59.90',
          currency: 'EUR',
          financialStatus: 'paid',
          fulfillmentStatus: 'fulfilled',
          cancelledAt: null
        }
      ]
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
    const shared = {
      id: 'shared-order',
      platform: 'shopify',
      orderNumber: '#45405',
      externalOrderId: '45405',
      processedAt: new Date('2026-06-05T09:00:00.000Z'),
      totalPrice: '59.90',
      currency: 'EUR',
      financialStatus: 'paid',
      fulfillmentStatus: 'fulfilled',
      cancelledAt: null
    };
    findMany
      .mockResolvedValueOnce([
        {
          id: 'email-order',
          platform: 'shopify',
          orderNumber: '#1001',
          externalOrderId: '1001',
          processedAt: new Date('2026-06-01T09:00:00.000Z'),
          totalPrice: '29.90',
          currency: 'EUR',
          financialStatus: 'paid',
          fulfillmentStatus: null,
          cancelledAt: null
        },
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
        Array.from({ length: 6 }, (_, index) => ({
          id: `email-order-${index}`,
          platform: 'shopify',
          orderNumber: `#10${index}`,
          externalOrderId: `10${index}`,
          processedAt: new Date(`2026-06-0${Math.min(index + 1, 9)}T09:00:00.000Z`),
          totalPrice: '10.00',
          currency: 'EUR',
          financialStatus: 'paid',
          fulfillmentStatus: null,
          cancelledAt: null
        }))
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
      {
        id: 'order-2',
        platform: 'shopify',
        orderNumber: null,
        externalOrderId: '27215069513',
        processedAt: new Date('2026-06-02T08:30:00.000Z'),
        totalPrice: { toString: () => '29.95' },
        currency: 'EUR',
        financialStatus: 'pending',
        fulfillmentStatus: null,
        cancelledAt: null
      }
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
      recentOrders: []
    });
  });
});

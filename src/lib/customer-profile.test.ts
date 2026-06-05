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

  it('normalizes email and returns total count plus five recent orders', async () => {
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
      orderCount: 6,
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

    expect(count).toHaveBeenCalledWith({
      where: {
        customerEmail: {
          equals: 'lola@example.com',
          mode: 'insensitive'
        }
      }
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        customerEmail: {
          equals: 'lola@example.com',
          mode: 'insensitive'
        }
      },
      orderBy: { processedAt: 'desc' },
      take: 5,
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
    });
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
    count.mockRejectedValue(new Error('database unavailable'));
    findMany.mockResolvedValue([]);

    await expect(getCustomerProfileByEmail('cliente@example.com')).resolves.toEqual({
      email: 'cliente@example.com',
      orderCount: 0,
      recentOrders: []
    });
  });
});

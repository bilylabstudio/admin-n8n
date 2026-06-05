import { db } from './db';

const RECENT_ORDER_LIMIT = 5;

export type CustomerOrderSummary = {
  id: string;
  platform: string;
  orderNumber: string;
  processedAt: string;
  totalPrice: string;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
};

export type CustomerProfile = {
  email: string;
  orderCount: number;
  recentOrders: CustomerOrderSummary[];
};

type PlatformOrderRow = {
  id: string;
  platform: string;
  orderNumber: string | null;
  externalOrderId: string;
  processedAt: Date;
  totalPrice: unknown;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  cancelledAt: Date | null;
};

export async function getCustomerProfileByEmail(
  emailInput: string | null | undefined
): Promise<CustomerProfile> {
  const email = normalizeCustomerEmail(emailInput);
  if (!email) return emptyCustomerProfile('');

  try {
    const where = {
      customerEmail: {
        equals: email,
        mode: 'insensitive' as const
      }
    };

    const [orderCount, recentRows] = await Promise.all([
      db.platformOrder.count({ where }),
      db.platformOrder.findMany({
        where,
        orderBy: { processedAt: 'desc' },
        take: RECENT_ORDER_LIMIT,
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
    ]);

    return {
      email,
      orderCount,
      recentOrders: recentRows.map(orderRowToSummary)
    };
  } catch {
    return emptyCustomerProfile(email);
  }
}

function normalizeCustomerEmail(emailInput: string | null | undefined) {
  return String(emailInput || '').trim().toLowerCase();
}

function emptyCustomerProfile(email: string): CustomerProfile {
  return {
    email,
    orderCount: 0,
    recentOrders: []
  };
}

function orderRowToSummary(row: PlatformOrderRow): CustomerOrderSummary {
  return {
    id: row.id,
    platform: row.platform,
    orderNumber: row.orderNumber || row.externalOrderId,
    processedAt: row.processedAt.toISOString(),
    totalPrice: decimalToString(row.totalPrice),
    currency: row.currency,
    financialStatus: row.financialStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    cancelledAt: row.cancelledAt?.toISOString() || null
  };
}

function decimalToString(value: unknown) {
  if (
    value &&
    typeof value === 'object' &&
    'toString' in value &&
    typeof (value as { toString: unknown }).toString === 'function'
  ) {
    return (value as { toString: () => string }).toString();
  }
  return String(value ?? '0');
}

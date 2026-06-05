import { db } from './db';

const RECENT_ORDER_LIMIT = 5;
const ORDER_LOOKUP_LIMIT = 25;
const ORDER_NUMBER_MIN_LENGTH = 4;
const ORDER_WORD_PATTERN = '(?:pedido|orden|order|compra|subscription|suscripcion)';
const HASH_ORDER_RE = /#\s*([A-Za-z0-9][A-Za-z0-9._-]{3,})/gi;
const WORD_ORDER_RE = new RegExp(
  `${ORDER_WORD_PATTERN}\\s*(?:n(?:umero|ro|o)?\\.?|number|#|:|-)?\\s*#?\\s*([A-Za-z0-9][A-Za-z0-9._-]{3,})`,
  'gi'
);

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

export type CustomerProfileLookupInput = {
  email: string | null | undefined;
  texts?: Array<string | null | undefined>;
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

export function extractOrderNumberCandidates(texts: Array<string | null | undefined>) {
  const candidates = new Set<string>();

  for (const text of texts) {
    const value = normalizeSearchText(text);
    collectMatches(value, HASH_ORDER_RE, candidates);
    collectMatches(value, WORD_ORDER_RE, candidates);
  }

  return [...candidates];
}

export async function getCustomerProfileByEmail(
  emailInput: string | null | undefined
): Promise<CustomerProfile> {
  return getCustomerProfile({ email: emailInput });
}

export async function getCustomerProfile(
  input: CustomerProfileLookupInput
): Promise<CustomerProfile> {
  const email = normalizeCustomerEmail(input.email);
  const orderNumbers = extractOrderNumberCandidates(input.texts || []);
  if (!email && !orderNumbers.length) return emptyCustomerProfile(email);

  try {
    const [emailRows, orderNumberRows] = await Promise.all([
      email ? findOrdersByEmail(email) : Promise.resolve([]),
      orderNumbers.length ? findOrdersByOrderNumbers(orderNumbers) : Promise.resolve([])
    ]);

    const orders = dedupeOrders([...orderNumberRows, ...emailRows]);

    return {
      email,
      orderCount: orders.length,
      recentOrders: orders.slice(0, RECENT_ORDER_LIMIT).map(orderRowToSummary)
    };
  } catch {
    return emptyCustomerProfile(email);
  }
}

async function findOrdersByEmail(email: string): Promise<PlatformOrderRow[]> {
  return db.platformOrder.findMany({
    where: {
      customerEmail: {
        equals: email,
        mode: 'insensitive'
      }
    },
    orderBy: { processedAt: 'desc' },
    take: ORDER_LOOKUP_LIMIT,
    select: platformOrderSelect()
  });
}

async function findOrdersByOrderNumbers(orderNumbers: string[]): Promise<PlatformOrderRow[]> {
  const orderNumberVariants = [...new Set(orderNumbers.flatMap((value) => [value, `#${value}`]))];

  return db.platformOrder.findMany({
    where: {
      OR: [
        { orderNumber: { in: orderNumberVariants } },
        { externalOrderId: { in: orderNumbers } }
      ]
    },
    orderBy: { processedAt: 'desc' },
    take: ORDER_LOOKUP_LIMIT,
    select: platformOrderSelect()
  });
}

function platformOrderSelect() {
  return {
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
  } as const;
}

function dedupeOrders(rows: PlatformOrderRow[]) {
  const seen = new Set<string>();
  const deduped: PlatformOrderRow[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    deduped.push(row);
  }

  return deduped;
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

function normalizeSearchText(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function collectMatches(value: string, pattern: RegExp, candidates: Set<string>) {
  pattern.lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const candidate = normalizeOrderCandidate(match[1]);
    if (candidate) candidates.add(candidate);
  }
}

function normalizeOrderCandidate(value: string | undefined) {
  const candidate = String(value || '')
    .trim()
    .replace(/^#+/, '')
    .replace(/[.,;:)\]]+$/g, '')
    .replace(/\s+/g, '');

  if (candidate.length < ORDER_NUMBER_MIN_LENGTH) return '';
  if (!/[0-9]/.test(candidate)) return '';
  return candidate;
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

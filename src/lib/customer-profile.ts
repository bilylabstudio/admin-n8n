import { db } from './db';

const RECENT_ORDER_LIMIT = 5;
const ORDER_LOOKUP_LIMIT = 25;
const ORDER_NUMBER_MIN_LENGTH = 4;
const GENERATED_LOOKBACK_DAYS = 7;
const RECEIVED_LOOKBACK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_WORD_PATTERN = '(?:pedido|orden|order|compra|subscription|suscripcion)';
const HASH_ORDER_RE = /#\s*([A-Za-z0-9][A-Za-z0-9._-]{3,})/gi;
const WORD_ORDER_RE = new RegExp(
  `${ORDER_WORD_PATTERN}\\s*(?:n(?:umero|ro|o)?\\.?|number|#|:|-)?\\s*#?\\s*([A-Za-z0-9][A-Za-z0-9._-]{3,})`,
  'gi'
);

export type SubscriptionOrderState =
  | 'generated_not_shipped'
  | 'generated_processed'
  | 'not_generated_detected'
  | 'unknown_charge_no_order';

export type SubscriptionOrderMatchType =
  | 'exact_order_number'
  | 'recent_generated'
  | 'received_window'
  | 'none';

export type IgnoredSubscriptionOrderSummary = {
  orderNumber: string;
  processedAt: string;
  reason: 'too_old_for_current_message' | 'cancelled_or_test' | 'not_exact_order_number';
};

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
  channel: string | null;
  isSubscriptionOrder: boolean;
  subscriptionEvidence: string[];
};

export type SubscriptionOrderContext = {
  hasRelevantSubscriptionOrder: boolean;
  state: SubscriptionOrderState;
  matchType: SubscriptionOrderMatchType;
  generatedLookbackDays: number;
  receivedLookbackDays: number;
  latestSubscriptionOrder: CustomerOrderSummary | null;
  ignoredSubscriptionOrders: IgnoredSubscriptionOrderSummary[];
};

export type CustomerProfile = {
  email: string;
  orderCount: number;
  recentOrders: CustomerOrderSummary[];
  subscriptionOrderContext: SubscriptionOrderContext;
};

export type CustomerProfileLookupInput = {
  email: string | null | undefined;
  texts?: Array<string | null | undefined>;
  referenceDate?: string | Date | null | undefined;
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
  channel: string | null;
  rawJson: unknown;
  isTest: boolean;
};

type SubscriptionEvidence = {
  isSubscriptionOrder: boolean;
  reasons: string[];
};

type SubscriptionMessageSignals = {
  futureNotice: boolean;
  receivedOrReturn: boolean;
  chargeClaim: boolean;
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
  const texts = input.texts || [];
  const referenceDate = parseReferenceDate(input.referenceDate);
  const orderNumbers = extractOrderNumberCandidates(texts);
  if (!email && !orderNumbers.length) return emptyCustomerProfile(email, texts, referenceDate);

  try {
    const [emailRows, orderNumberRows] = await Promise.all([
      email ? findOrdersByEmail(email) : Promise.resolve([]),
      orderNumbers.length ? findOrdersByOrderNumbers(orderNumbers) : Promise.resolve([])
    ]);

    const orders = dedupeOrders([...orderNumberRows, ...emailRows]);
    const subscriptionOrderContext = buildSubscriptionOrderContext({
      orders,
      orderNumbers,
      texts,
      referenceDate
    });

    return {
      email,
      orderCount: orders.length,
      recentOrders: orders.slice(0, RECENT_ORDER_LIMIT).map(orderRowToSummary),
      subscriptionOrderContext
    };
  } catch {
    return emptyCustomerProfile(email, texts, referenceDate);
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
    cancelledAt: true,
    channel: true,
    rawJson: true,
    isTest: true
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

function buildSubscriptionOrderContext(input: {
  orders: PlatformOrderRow[];
  orderNumbers: string[];
  texts: Array<string | null | undefined>;
  referenceDate: Date;
}): SubscriptionOrderContext {
  const signals = getSubscriptionMessageSignals(input.texts);
  const orderNumberSet = new Set(input.orderNumbers.map(normalizeOrderCandidate).filter(Boolean));
  const subscriptionOrders = input.orders
    .map((order) => ({ order, evidence: getSubscriptionEvidence(order) }))
    .filter(({ evidence }) => evidence.isSubscriptionOrder);
  const ignoredSubscriptionOrders: IgnoredSubscriptionOrderSummary[] = [];

  const activeSubscriptionOrders = subscriptionOrders.filter(({ order }) => {
    if (isCancelledOrTestOrder(order)) {
      addIgnoredOrder(ignoredSubscriptionOrders, order, 'cancelled_or_test');
      return false;
    }
    return true;
  });

  if (orderNumberSet.size) {
    const exactMatches = activeSubscriptionOrders.filter(({ order }) =>
      orderMatchesAnyCandidate(order, orderNumberSet)
    );
    const latestExact = newestOrder(exactMatches.map(({ order }) => order));

    if (latestExact) {
      return relevantSubscriptionContext(latestExact, 'exact_order_number', ignoredSubscriptionOrders);
    }

    for (const { order } of activeSubscriptionOrders) {
      addIgnoredOrder(ignoredSubscriptionOrders, order, 'not_exact_order_number');
    }

    return noRelevantSubscriptionContext(signals, ignoredSubscriptionOrders);
  }

  const lookbackDays = signals.receivedOrReturn ? RECEIVED_LOOKBACK_DAYS : GENERATED_LOOKBACK_DAYS;
  const recentSubscriptionOrders = activeSubscriptionOrders
    .filter(({ order }) => isWithinLookback(order.processedAt, input.referenceDate, lookbackDays))
    .map(({ order }) => order);
  const latestRecent = newestOrder(recentSubscriptionOrders);

  if (latestRecent) {
    const matchType: SubscriptionOrderMatchType =
      signals.receivedOrReturn && !isWithinLookback(latestRecent.processedAt, input.referenceDate, GENERATED_LOOKBACK_DAYS)
        ? 'received_window'
        : 'recent_generated';
    return relevantSubscriptionContext(latestRecent, matchType, ignoredSubscriptionOrders);
  }

  for (const { order } of activeSubscriptionOrders) {
    addIgnoredOrder(ignoredSubscriptionOrders, order, 'too_old_for_current_message');
  }

  return noRelevantSubscriptionContext(signals, ignoredSubscriptionOrders);
}

function relevantSubscriptionContext(
  order: PlatformOrderRow,
  matchType: SubscriptionOrderMatchType,
  ignoredSubscriptionOrders: IgnoredSubscriptionOrderSummary[]
): SubscriptionOrderContext {
  return {
    hasRelevantSubscriptionOrder: true,
    state: subscriptionStateForOrder(order),
    matchType,
    generatedLookbackDays: GENERATED_LOOKBACK_DAYS,
    receivedLookbackDays: RECEIVED_LOOKBACK_DAYS,
    latestSubscriptionOrder: orderRowToSummary(order),
    ignoredSubscriptionOrders: ignoredSubscriptionOrders.slice(0, 5)
  };
}

function noRelevantSubscriptionContext(
  signals: SubscriptionMessageSignals,
  ignoredSubscriptionOrders: IgnoredSubscriptionOrderSummary[]
): SubscriptionOrderContext {
  return {
    hasRelevantSubscriptionOrder: false,
    state: signals.chargeClaim ? 'unknown_charge_no_order' : 'not_generated_detected',
    matchType: 'none',
    generatedLookbackDays: GENERATED_LOOKBACK_DAYS,
    receivedLookbackDays: RECEIVED_LOOKBACK_DAYS,
    latestSubscriptionOrder: null,
    ignoredSubscriptionOrders: ignoredSubscriptionOrders.slice(0, 5)
  };
}

function addIgnoredOrder(
  rows: IgnoredSubscriptionOrderSummary[],
  order: PlatformOrderRow,
  reason: IgnoredSubscriptionOrderSummary['reason']
) {
  rows.push({
    orderNumber: order.orderNumber || order.externalOrderId,
    processedAt: order.processedAt.toISOString(),
    reason
  });
}

function newestOrder(orders: PlatformOrderRow[]) {
  return [...orders].sort((a, b) => b.processedAt.getTime() - a.processedAt.getTime())[0] || null;
}

function subscriptionStateForOrder(order: PlatformOrderRow): SubscriptionOrderState {
  const fulfillment = normalizeKey(order.fulfillmentStatus);
  if (!fulfillment || fulfillment === 'unfulfilled' || fulfillment === 'null' || fulfillment === 'none') {
    return 'generated_not_shipped';
  }
  return 'generated_processed';
}

function isCancelledOrTestOrder(order: PlatformOrderRow) {
  return Boolean(order.cancelledAt || order.isTest);
}

function isWithinLookback(orderDate: Date, referenceDate: Date, lookbackDays: number) {
  const diffDays = (referenceDate.getTime() - orderDate.getTime()) / DAY_MS;
  return diffDays >= 0 && diffDays <= lookbackDays;
}

function orderMatchesAnyCandidate(order: PlatformOrderRow, candidates: Set<string>) {
  const orderVariants = [
    order.orderNumber,
    order.externalOrderId,
    normalizeOrderCandidate(order.orderNumber || ''),
    normalizeOrderCandidate(order.externalOrderId)
  ].map((value) => normalizeOrderCandidate(String(value || '')));

  return orderVariants.some((value) => value && candidates.has(value));
}

function getSubscriptionEvidence(order: PlatformOrderRow): SubscriptionEvidence {
  const reasons = new Set<string>();
  const raw = asRecord(order.rawJson);
  const sourceName = normalizeKey(raw.source_name ?? raw.sourceName);

  if (containsSubscriptionSignal(order.channel)) reasons.add('channel_subscription');
  if (sourceName.includes('loop') || sourceName.includes('subscription')) {
    reasons.add('source_name_subscription');
  }

  for (const item of asRecordArray(raw.line_items ?? raw.lineItems)) {
    const itemText = normalizeKey([
      item.name,
      item.title,
      item.variant_title,
      item.variantTitle,
      item.sku
    ].join(' '));

    if (item.selling_plan_allocation || item.sellingPlanAllocation || item.selling_plan) {
      reasons.add('line_item_selling_plan');
    }
    if (/\brecarga\b|suscripcion|subscription|cada_\d+_dias|cada_\d+_dia/.test(itemText)) {
      reasons.add('line_item_subscription_text');
    }
    if (linePropertiesContainSubscriptionSignal(item)) {
      reasons.add('line_item_subscription_property');
    }
  }

  return {
    isSubscriptionOrder: reasons.size > 0,
    reasons: [...reasons]
  };
}

function linePropertiesContainSubscriptionSignal(item: Record<string, unknown>) {
  const properties = item.properties;
  if (!Array.isArray(properties)) return false;

  return properties.some((property) => {
    const record = asRecord(property);
    return containsSubscriptionSignal([record.name, record.value].join(' '));
  });
}

function containsSubscriptionSignal(value: unknown) {
  const text = normalizeKey(value);
  return /loop|subscription|suscripcion|recarga|selling_plan/.test(text);
}

function getSubscriptionMessageSignals(texts: Array<string | null | undefined>): SubscriptionMessageSignals {
  const text = normalizeKey(texts.join(' ')).replace(/_/g, ' ');

  return {
    futureNotice:
      /proximo pedido|pedido proximo|llega pronto|sera enviado|pedido sera enviado|proxima recarga|recarga proxima/.test(text),
    receivedOrReturn:
      /recibid|ha llegado|me llego|me ha llegado|devolver|devolucion|devuelvo|reembolso|devolucion/.test(text),
    chargeClaim:
      /me han cobrado|me habeis cobrado|cobro|cobrado|cargo|tarjeta|banco|importe|pago no reconocido|cobro no reconocido/.test(text)
  };
}

function normalizeCustomerEmail(emailInput: string | null | undefined) {
  return String(emailInput || '').trim().toLowerCase();
}

function emptyCustomerProfile(
  email: string,
  texts: Array<string | null | undefined> = [],
  referenceDate = new Date()
): CustomerProfile {
  return {
    email,
    orderCount: 0,
    recentOrders: [],
    subscriptionOrderContext: buildSubscriptionOrderContext({
      orders: [],
      orderNumbers: extractOrderNumberCandidates(texts),
      texts,
      referenceDate
    })
  };
}

function orderRowToSummary(row: PlatformOrderRow): CustomerOrderSummary {
  const evidence = getSubscriptionEvidence(row);

  return {
    id: row.id,
    platform: row.platform,
    orderNumber: row.orderNumber || row.externalOrderId,
    processedAt: row.processedAt.toISOString(),
    totalPrice: decimalToString(row.totalPrice),
    currency: row.currency,
    financialStatus: row.financialStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    cancelledAt: row.cancelledAt?.toISOString() || null,
    channel: row.channel || null,
    isSubscriptionOrder: evidence.isSubscriptionOrder,
    subscriptionEvidence: evidence.reasons
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

function parseReferenceDate(value: string | Date | null | undefined) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function normalizeKey(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord);
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

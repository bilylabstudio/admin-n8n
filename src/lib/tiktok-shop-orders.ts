import type { PlatformOrderInput } from './platform-orders';

export type TikTokShopOrdersParseOptions = {
  includeRawJson?: boolean;
};

export type TikTokShopOrdersParseResult = {
  orders: PlatformOrderInput[];
  rowsSkipped: Array<{ index: number; reason: string }>;
};

type TikTokOrder = Record<string, unknown>;

export function parseTikTokShopOrders(
  input: unknown,
  options: TikTokShopOrdersParseOptions = {}
): TikTokShopOrdersParseResult {
  const rawOrders = extractOrders(input);
  const rowsSkipped: TikTokShopOrdersParseResult['rowsSkipped'] = [];
  const orders: PlatformOrderInput[] = [];

  rawOrders.forEach((rawOrder, index) => {
    const externalOrderId = stringField(rawOrder, ['id', 'order_id', 'orderId']);
    if (!externalOrderId) {
      rowsSkipped.push({ index, reason: 'missing_order_id' });
      return;
    }

    const processedAt = dateField(rawOrder, [
      'create_time',
      'createTime',
      'created_at',
      'createdAt',
      'paid_time',
      'paidTime'
    ]);
    const externalUpdatedAt =
      dateField(rawOrder, ['update_time', 'updateTime', 'updated_at', 'updatedAt']) || processedAt;

    if (!processedAt || !externalUpdatedAt) {
      rowsSkipped.push({ index, reason: 'invalid_order_dates' });
      return;
    }

    orders.push(toPlatformOrder(rawOrder, externalOrderId, processedAt, externalUpdatedAt, Boolean(options.includeRawJson)));
  });

  return { orders, rowsSkipped };
}

function extractOrders(input: unknown): TikTokOrder[] {
  if (Array.isArray(input)) return input.filter(isRecord);
  if (!isRecord(input)) return [];

  const candidates = [
    input.orders,
    input.order_list,
    input.list,
    isRecord(input.data) ? input.data.orders : undefined,
    isRecord(input.data) ? input.data.order_list : undefined,
    isRecord(input.data) ? input.data.list : undefined
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}

function toPlatformOrder(
  order: TikTokOrder,
  externalOrderId: string,
  processedAt: string,
  externalUpdatedAt: string,
  includeRawJson: boolean
): PlatformOrderInput {
  const payment = firstRecord(order, ['payment', 'payment_info', 'paymentInfo', 'order_amount']);
  const recipient = firstRecord(order, ['recipient_address', 'recipientAddress', 'shipping_address', 'shippingAddress']);
  const lineItems = extractLineItems(order);
  const status = stringField(order, ['status', 'order_status', 'orderStatus', 'fulfillment_status']);
  const paymentStatus = stringField(order, ['payment_status', 'paymentStatus']) || status;

  const subtotal = moneyField(order, payment, ['subtotal', 'sub_total', 'subTotal', 'product_total', 'productTotal']);
  const totalTax = moneyField(order, payment, ['tax', 'tax_amount', 'taxAmount']);
  const totalShipping = moneyField(order, payment, ['shipping_fee', 'shippingFee', 'shipping_amount', 'shippingAmount']);
  const totalDiscounts = moneyField(order, payment, ['total_discount', 'discount', 'discount_amount', 'discountAmount']);
  const totalPrice =
    moneyField(order, payment, ['total_amount', 'totalAmount', 'order_total', 'orderTotal', 'paid_amount', 'paidAmount']) ||
    subtotal + totalTax + totalShipping - totalDiscounts;
  const totalRefunded = moneyField(order, payment, ['refund_amount', 'refundAmount', 'total_refund', 'totalRefund']);
  const currency =
    stringField(order, ['currency', 'currency_code', 'currencyCode']) ||
    stringField(payment, ['currency', 'currency_code', 'currencyCode']) ||
    'EUR';

  return {
    platform: 'tiktok_shop',
    external_order_id: externalOrderId,
    order_number: stringField(order, ['order_number', 'orderNumber', 'display_id', 'displayId']) || externalOrderId,
    currency,
    processed_at: processedAt,
    financial_status: financialStatus(paymentStatus, totalRefunded, totalPrice),
    fulfillment_status: fulfillmentStatus(status),
    cancelled_at: cancelledAt(order, status),
    is_test: false,
    subtotal: moneyString(subtotal),
    total_tax: moneyString(totalTax),
    total_shipping: moneyString(totalShipping),
    total_discounts: moneyString(totalDiscounts),
    total_price: moneyString(totalPrice),
    total_refunded: moneyString(totalRefunded),
    total_units: totalUnits(lineItems),
    customer_email: null,
    country_code:
      stringField(order, ['country_code', 'countryCode', 'shipping_country', 'shippingCountry']) ||
      stringField(recipient, ['region_code', 'regionCode', 'country_code', 'countryCode']),
    channel: 'tiktok_shop',
    ...(includeRawJson ? { raw_json: order } : {}),
    external_updated_at: externalUpdatedAt
  };
}

function extractLineItems(order: TikTokOrder): TikTokOrder[] {
  const candidates = [
    order.line_items,
    order.lineItems,
    order.items,
    order.skus,
    isRecord(order.item_list) ? order.item_list.items : order.item_list
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}

function totalUnits(items: TikTokOrder[]) {
  const total = items.reduce((sum, item) => sum + intField(item, ['quantity', 'qty', 'product_count']), 0);
  return total > 0 ? total : 1;
}

function financialStatus(status: string, totalRefunded: number, totalPrice: number) {
  const normalized = normalize(status);
  if (/cancel|void|closed/.test(normalized)) return 'voided';
  if (totalRefunded > 0 && totalPrice > 0 && totalRefunded < totalPrice) return 'partially_refunded';
  if (totalRefunded > 0) return 'refunded';
  if (/refund/.test(normalized)) return 'refunded';
  if (/unpaid|pending|awaiting_payment/.test(normalized)) return 'pending';
  return 'paid';
}

function fulfillmentStatus(status: string) {
  const normalized = normalize(status);
  if (!normalized) return null;
  if (/cancel|void|closed/.test(normalized)) return 'cancelled_tiktok_shop';
  if (/delivered|completed/.test(normalized)) return 'fulfilled_tiktok_shop';
  if (/shipped|in_transit|to_ship|awaiting_shipment/.test(normalized)) return 'unfulfilled_tiktok_shop';
  return normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || null;
}

function cancelledAt(order: TikTokOrder, status: string) {
  if (!/cancel|void|closed/.test(normalize(status))) return null;
  return dateField(order, ['cancel_time', 'cancelTime', 'cancelled_at', 'cancelledAt']) || null;
}

function moneyField(primary: TikTokOrder, secondary: TikTokOrder | null, names: string[]) {
  for (const source of [primary, secondary]) {
    if (!source) continue;
    for (const name of names) {
      if (name in source) return money(source[name]);
    }
  }
  return 0;
}

function stringField(record: TikTokOrder | null, names: string[]) {
  if (!record) return '';
  for (const name of names) {
    const value = record[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function intField(record: TikTokOrder, names: string[]) {
  for (const name of names) {
    const parsed = Number.parseInt(String(record[name] ?? ''), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function dateField(record: TikTokOrder, names: string[]) {
  for (const name of names) {
    const iso = toIso(record[name]);
    if (iso) return iso;
  }
  return null;
}

function firstRecord(record: TikTokOrder, names: string[]) {
  for (const name of names) {
    const value = record[name];
    if (isRecord(value)) return value;
  }
  return null;
}

function money(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isRecord(value)) {
    if ('amount' in value) return money(value.amount);
    if ('value' in value) return money(value.value);
  }
  const cleaned = String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, '').trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyString(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function toIso(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const numeric = Number(value);
    const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalize(value: string) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function isRecord(value: unknown): value is TikTokOrder {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

import type { PlatformOrderInput } from './platform-orders';

export type AmazonOrdersParseOptions = {
  includeRawJson?: boolean;
};

export type AmazonOrdersParseResult = {
  orders: PlatformOrderInput[];
  rowsSkipped: Array<{ line: number; reason: string }>;
};

type AmazonFlatRow = Record<string, string>;

type OrderAccumulator = {
  externalOrderId: string;
  orderNumber: string | null;
  currency: string;
  processedAt: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
  subtotal: number;
  totalTax: number;
  totalShipping: number;
  totalDiscounts: number;
  giftWrap: number;
  totalRefunded: number;
  totalUnits: number;
  countryCode: string | null;
  channel: string | null;
  externalUpdatedAt: string;
  rows: AmazonFlatRow[];
};

export function parseAmazonOrdersTsv(
  tsv: string,
  options: AmazonOrdersParseOptions = {}
): AmazonOrdersParseResult {
  const normalized = tsv.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0);
  if (!lines.length) return { orders: [], rowsSkipped: [] };

  const headers = lines[0].split('\t').map((header) => header.trim().toLowerCase());
  const rowsSkipped: AmazonOrdersParseResult['rowsSkipped'] = [];
  const byOrder = new Map<string, OrderAccumulator>();

  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const cells = lines[index].split('\t');
    const row: AmazonFlatRow = {};
    headers.forEach((header, cellIndex) => {
      row[header] = (cells[cellIndex] ?? '').trim();
    });

    const externalOrderId = row['amazon-order-id'];
    if (!externalOrderId) {
      rowsSkipped.push({ line: lineNumber, reason: 'missing_amazon_order_id' });
      continue;
    }

    const purchaseDate = toIso(row['purchase-date']);
    const updatedDate = toIso(row['last-updated-date'] || row['purchase-date']);
    if (!purchaseDate || !updatedDate) {
      rowsSkipped.push({ line: lineNumber, reason: 'invalid_order_dates' });
      continue;
    }

    const existing = byOrder.get(externalOrderId);
    const orderStatus = normalizeStatus(row['order-status']);
    const fulfillmentStatus = normalizeFulfillment(row['order-status'], row['fulfillment-channel']);
    const current: OrderAccumulator =
      existing ??
      {
        externalOrderId,
        orderNumber: row['merchant-order-id'] || externalOrderId,
        currency: row.currency || 'EUR',
        processedAt: purchaseDate,
        financialStatus: orderStatus,
        fulfillmentStatus,
        cancelledAt: orderStatus === 'voided' ? updatedDate : null,
        subtotal: 0,
        totalTax: 0,
        totalShipping: 0,
        totalDiscounts: 0,
        giftWrap: 0,
        totalRefunded: 0,
        totalUnits: 0,
        countryCode: row['ship-country'] || null,
        channel: row['sales-channel'] || row['fulfillment-channel'] || null,
        externalUpdatedAt: updatedDate,
        rows: []
      };

    current.processedAt = minIso(current.processedAt, purchaseDate);
    current.externalUpdatedAt = maxIso(current.externalUpdatedAt, updatedDate);
    current.financialStatus = mergeFinancialStatus(current.financialStatus, orderStatus);
    current.fulfillmentStatus = current.fulfillmentStatus || fulfillmentStatus;
    current.cancelledAt = current.financialStatus === 'voided' ? current.externalUpdatedAt : null;
    current.currency = current.currency || row.currency || 'EUR';
    current.countryCode = current.countryCode || row['ship-country'] || null;
    current.channel = current.channel || row['sales-channel'] || row['fulfillment-channel'] || null;
    current.subtotal += money(row['item-price']);
    current.totalTax += money(row['item-tax']) + money(row['shipping-tax']) + money(row['gift-wrap-tax']);
    current.totalShipping += money(row['shipping-price']);
    current.totalDiscounts += money(row['item-promotion-discount']) + money(row['ship-promotion-discount']);
    current.giftWrap += money(row['gift-wrap-price']);
    current.totalUnits += quantity(row.quantity);
    current.rows.push(row);
    byOrder.set(externalOrderId, current);
  }

  const orders = [...byOrder.values()]
    .sort((a, b) => a.processedAt.localeCompare(b.processedAt))
    .map((order) => toPlatformOrder(order, Boolean(options.includeRawJson)));

  return { orders, rowsSkipped };
}

function toPlatformOrder(order: OrderAccumulator, includeRawJson: boolean): PlatformOrderInput {
  const totalPrice =
    order.subtotal + order.totalTax + order.totalShipping + order.giftWrap - order.totalDiscounts;

  return {
    platform: 'amazon',
    external_order_id: order.externalOrderId,
    order_number: order.orderNumber,
    currency: order.currency || 'EUR',
    processed_at: order.processedAt,
    financial_status: order.financialStatus,
    fulfillment_status: order.fulfillmentStatus,
    cancelled_at: order.cancelledAt,
    is_test: false,
    subtotal: moneyString(order.subtotal),
    total_tax: moneyString(order.totalTax),
    total_shipping: moneyString(order.totalShipping),
    total_discounts: moneyString(order.totalDiscounts),
    total_price: moneyString(totalPrice),
    total_refunded: moneyString(order.totalRefunded),
    total_units: order.totalUnits,
    customer_email: null,
    country_code: order.countryCode,
    channel: order.channel,
    ...(includeRawJson ? { raw_json: { rows: order.rows } } : {}),
    external_updated_at: order.externalUpdatedAt
  };
}

function normalizeStatus(status: string | undefined): string {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'canceled' || value === 'cancelled') return 'voided';
  if (value === 'shipped' || value === 'unshipped' || value === 'partiallyshipped') return 'paid';
  return 'pending';
}

function normalizeFulfillment(status: string | undefined, channel: string | undefined): string | null {
  const statusValue = String(status || '').trim().toLowerCase();
  const channelValue = String(channel || '').trim().toLowerCase();
  const channelSuffix = channelValue || 'unknown';
  if (statusValue === 'canceled' || statusValue === 'cancelled') return `cancelled_${channelSuffix}`;
  if (statusValue === 'shipped') return `fulfilled_${channelSuffix}`;
  if (statusValue === 'partiallyshipped') return `partial_${channelSuffix}`;
  if (statusValue === 'unshipped') return `unfulfilled_${channelSuffix}`;
  return channelValue ? `unknown_${channelSuffix}` : null;
}

function mergeFinancialStatus(current: string, incoming: string): string {
  if (current === 'voided' || incoming === 'voided') return 'voided';
  if (current === 'paid' || incoming === 'paid') return 'paid';
  return incoming || current || 'pending';
}

function money(value: string | undefined): number {
  const cleaned = String(value || '').replace(',', '.').trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantity(value: string | undefined): number {
  const parsed = Number.parseInt(String(value || '0'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function moneyString(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

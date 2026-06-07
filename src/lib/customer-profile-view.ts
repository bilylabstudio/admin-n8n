export type CustomerOrderSummaryView = {
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

export type CustomerProfileView = {
  email: string;
  orderCount: number;
  recentOrders: CustomerOrderSummaryView[];
};

const PAYMENT_LABELS: Record<string, string> = {
  paid: 'pagado',
  pending: 'pendiente',
  refunded: 'reembolsado',
  partially_refunded: 'reembolso parcial',
  authorized: 'autorizado',
  voided: 'anulado'
};

const FULFILLMENT_LABELS: Record<string, string> = {
  fulfilled: 'enviado',
  partial: 'parcial',
  restocked: 'devuelto a stock',
  unfulfilled: 'sin envio'
};

export function formatOrderCountLabel(orderCount: number) {
  return orderCount === 1 ? '1 pedido encontrado' : `${orderCount} pedidos encontrados`;
}

export function formatCustomerOrderLine(order: CustomerOrderSummaryView) {
  return [
    formatOrderNumber(order),
    formatOrderDate(order.processedAt),
    formatOrderAmount(order.totalPrice, order.currency),
    paymentStatusLabel(order.financialStatus),
    fulfillmentStatusLabel(order)
  ].join(' - ');
}

export function paymentStatusLabel(status: string | null | undefined) {
  const key = String(status || '').trim().toLowerCase();
  if (!key) return 'pago sin datos';
  return PAYMENT_LABELS[key] || key.replace(/_/g, ' ');
}

export function fulfillmentStatusLabel(order: {
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
}) {
  if (order.cancelledAt) return 'cancelado';
  const key = String(order.fulfillmentStatus || '').trim().toLowerCase();
  if (!key) return 'sin envio';
  return FULFILLMENT_LABELS[key] || key.replace(/_/g, ' ');
}

function formatOrderNumber(order: CustomerOrderSummaryView) {
  const value = String(order.orderNumber || order.id || '').trim();
  if (!value) return '#sin-numero';
  return value.startsWith('#') ? value : `#${value}`;
}

function formatOrderDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'fecha sin datos';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Madrid'
  }).format(date);
}

function formatOrderAmount(value: string, currency: string) {
  const amount = Number(value);
  const cleanCurrency = String(currency || 'EUR').trim() || 'EUR';
  if (!Number.isFinite(amount)) return `${value} ${cleanCurrency}`;
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: cleanCurrency,
    currencyDisplay: 'code'
  })
    .format(amount)
    .replace(/\s+/g, ' ')
    .trim();
}

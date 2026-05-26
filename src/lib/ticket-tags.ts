export const ticketTagDefinitions = [
  { id: 'escalate', label: 'Escalar', tone: 'danger' },
  { id: 'refund', label: 'Devolucion', tone: 'warning' },
  { id: 'shipping', label: 'Problema envio', tone: 'info' },
  { id: 'product', label: 'Problema producto', tone: 'neutral' }
] as const;

export type TicketTagId = (typeof ticketTagDefinitions)[number]['id'];
export type TicketTag = (typeof ticketTagDefinitions)[number];

export type TaggableTicket = {
  subject?: string | null;
  originalText?: string | null;
  category?: string | null;
  intent?: string | null;
  riskFlags?: string | null;
  escalationRecommended?: boolean | null;
};

const escalationPatterns = ['riesgo', 'humana', 'humano', 'manual', 'escalar', 'revisar'];

const refundPatterns = [
  'devolucion',
  'devolver',
  'reembolso',
  'rembolso',
  'cancelar',
  'cancelacion',
  'anular',
  'anulacion',
  'baja',
  'suscripcion',
  'dinero',
  'formulario'
];

const shippingPatterns = [
  'envio',
  'enviar',
  'mensajeria',
  'transportista',
  'seguimiento',
  'tracking',
  'tipsa',
  'nacex',
  'correos express',
  'no recibido',
  'no he recibido',
  'no ha llegado',
  'no me ha llegado',
  'no me han llegado',
  'no llega',
  'no llegan',
  'todavia no me',
  'aun no me',
  'donde esta',
  'cuando llega',
  'direccion incompleta',
  'direccion de envio',
  'falta el numero',
  'numero de mi casa',
  'order_status',
  'logistica'
];

const productPatterns = [
  'producto',
  'gomitas',
  'gominolas',
  'dosis',
  'tomar',
  'tomarlas',
  'efectos',
  'resultados',
  'salud',
  'ingredientes',
  'no noto',
  'no he notado',
  'me funciona',
  'me funcionan',
  'diarrea',
  'hinchazon',
  'digestion',
  'diuretico',
  'retencion de liquidos',
  'cuanto tiempo'
];

export function getTicketTags(ticket: TaggableTicket): TicketTag[] {
  const haystack = normalize(
    [ticket.subject, ticket.originalText, ticket.category, ticket.intent, ticket.riskFlags].join(' ')
  );
  const riskHaystack = normalize([ticket.category, ticket.intent, ticket.riskFlags].join(' '));
  const ids: TicketTagId[] = [];

  if (ticket.escalationRecommended || includesAny(riskHaystack, escalationPatterns)) {
    ids.push('escalate');
  }

  if (includesAny(haystack, refundPatterns)) {
    ids.push('refund');
  }

  if (includesAny(haystack, shippingPatterns)) {
    ids.push('shipping');
  }

  if (includesAny(haystack, productPatterns)) {
    ids.push('product');
  }

  return ids.map((id) => ticketTagDefinitions.find((tag) => tag.id === id)).filter(isTicketTag);
}

function includesAny(value: string, patterns: string[]) {
  return patterns.some((pattern) => value.includes(pattern));
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isTicketTag(tag: (typeof ticketTagDefinitions)[number] | undefined): tag is TicketTag {
  return Boolean(tag);
}

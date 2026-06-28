export const ticketTagDefinitions = [
  { id: 'warehouse', label: 'Incidencia almacen', tone: 'danger' },
  { id: 'office_3x2', label: 'Enviar unidad extra', tone: 'warning' },
  { id: 'carrier_incident', label: 'Incidencia transporte', tone: 'danger' },
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

// Banderas de incidencia puestas por el bot (no por el texto del cliente): se buscan
// solo en category/intent/riskFlags para no disparar con que el cliente escriba
// "almacen" o "error 3x2" en su mensaje. Tokens: incidencia_almacen / error_3x2.
const warehousePatterns = ['incidencia_almacen', 'incidencia almacen'];
const office3x2Patterns = ['error_3x2', 'error 3x2'];
const carrierIncidentRiskPatterns = [
  'incidencia_transporte',
  'incidencia transporte',
  'incidencia_tipsa',
  'incidencia tipsa',
  'carrier_incident',
  'tipsa_incident'
];

const carrierIncidentCarrierPatterns = [
  'tipsa',
  'dinapaq',
  'transportista',
  'mensajeria',
  'repartidor',
  'empresa de transporte',
  'agencia de transporte'
];

const carrierIncidentEvidencePatterns = [
  'ausente',
  'destinatario ausente',
  'dado por ausente',
  'perdido',
  'extraviado',
  'incidencia',
  'intento falso',
  'estaba en casa',
  'no aparece informacion',
  'no hay informacion',
  'entregado pero no recibido',
  'entregado y no recibido',
  'entregado y no lo he recibido',
  'devuelto por ausencia',
  'devolucion por ausencia',
  'no localizado'
];

const carrierIncidentStrongTextPatterns = [
  'paquete perdido',
  'pedido perdido',
  'perdido el paquete',
  'perdido mi paquete',
  'paquete extraviado',
  'pedido extraviado',
  'dado por ausente',
  'destinatario ausente',
  'marcado como ausente',
  'me marca ausente',
  'intento falso de entrega',
  'entregado pero no recibido',
  'entregado y no recibido',
  'entregado y no lo he recibido'
];

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

  if (includesAny(riskHaystack, warehousePatterns)) {
    ids.push('warehouse');
  }

  if (includesAny(riskHaystack, office3x2Patterns)) {
    ids.push('office_3x2');
  }

  if (includesAny(riskHaystack, carrierIncidentRiskPatterns) || hasCarrierIncidentText(haystack)) {
    ids.push('carrier_incident');
  }

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

function hasCarrierIncidentText(value: string) {
  return (
    includesAny(value, carrierIncidentStrongTextPatterns) ||
    (includesAny(value, carrierIncidentCarrierPatterns) && includesAny(value, carrierIncidentEvidencePatterns))
  );
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

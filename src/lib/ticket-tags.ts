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

// Incluye los tokens que el bot pone en riskFlags/route cuando un caso no encaja en
// plantilla y debe revisarse (camino de respuesta razonada): requires_review,
// human_review y revision. Asi un ticket marcado para revision SIEMPRE muestra el
// chip "Escalar" de forma consistente en lista, conversacion y detalle.
const escalationPatterns = [
  'riesgo',
  'humana',
  'humano',
  'manual',
  'escalar',
  'revisar',
  'revision',
  'requires_review',
  'human_review',
  'reasoned_reply'
];

// Chips de intencion (Devolucion / Problema envio / Problema producto) derivados de la
// CLASIFICACION del bot (category/intent), NO del texto crudo del cliente. Asi un
// mensaje que menciona "suscripcion" o "me funcionan" ya no dispara chips si la IA
// entendio otra intencion (caso Rocio). El texto del cliente solo se usa para la
// incidencia de transporte, que necesita senales explicitas del propio mensaje.
function isRefundClassification(category: string, intent: string) {
  return (
    ['refund_status', 'return', 'subscription_cancel'].includes(intent) ||
    category.includes('devolucion') ||
    category.includes('reclamo') ||
    category.includes('reembolso')
  );
}

function isShippingClassification(category: string, intent: string) {
  return (
    intent === 'order_status' ||
    category.includes('logistica') ||
    category.includes('envio') ||
    category.includes('transporte')
  );
}

function isProductClassification(category: string, intent: string) {
  return intent === 'product' || category.startsWith('producto');
}

export function getTicketTags(ticket: TaggableTicket): TicketTag[] {
  // Solo campos estructurados que pone el bot; nunca el texto crudo del cliente.
  const riskHaystack = normalize([ticket.category, ticket.intent, ticket.riskFlags].join(' '));
  // El texto del cliente se usa exclusivamente para detectar incidencias de transporte,
  // que requieren senales explicitas del propio mensaje (paquete perdido, ausente, ...).
  const carrierText = normalize(
    [ticket.subject, ticket.originalText, ticket.category, ticket.intent, ticket.riskFlags].join(' ')
  );
  const category = normalize(ticket.category ?? '');
  const intent = normalize(ticket.intent ?? '');
  const ids: TicketTagId[] = [];

  if (includesAny(riskHaystack, warehousePatterns)) {
    ids.push('warehouse');
  }

  if (includesAny(riskHaystack, office3x2Patterns)) {
    ids.push('office_3x2');
  }

  const carrierIncident =
    includesAny(riskHaystack, carrierIncidentRiskPatterns) || hasCarrierIncidentText(carrierText);
  if (carrierIncident) {
    ids.push('carrier_incident');
  }

  if (ticket.escalationRecommended || includesAny(riskHaystack, escalationPatterns)) {
    ids.push('escalate');
  }

  if (isRefundClassification(category, intent)) {
    ids.push('refund');
  }

  // Una incidencia de transporte es tambien, por definicion, un problema de envio.
  if (isShippingClassification(category, intent) || carrierIncident) {
    ids.push('shipping');
  }

  if (isProductClassification(category, intent)) {
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

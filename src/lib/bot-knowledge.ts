import type { Prisma } from '@prisma/client';
import approvedReplyMemorySeed from '../data/approved-reply-memory.seed.json';
import {
  extractOrderNumberCandidates,
  getCustomerProfile,
  type PromoOrderContext,
  type SubscriptionOrderContext
} from './customer-profile';
import { fetchLiveSubscriptionOrders } from './shopify-live-lookup';
import { db } from './db';

const HISTORY_LIMIT = 6;
const APPROVED_RESPONSE_SCAN_LIMIT = 80;
const APPROVED_RESPONSE_RETURN_LIMIT = 10;
const STOPWORDS = new Set([
  'para', 'pero', 'como', 'cuando', 'donde', 'desde', 'sobre', 'esta', 'este',
  'esto', 'estos', 'estas', 'tengo', 'tienes', 'tiene', 'tenemos', 'hola',
  'buenos', 'buenas', 'dias', 'tardes', 'noches', 'gracias', 'saludo',
  'saludos', 'susana', 'customer', 'support', 'pedido', 'pedidos'
]);

type CaseClassification = {
  family?: unknown;
  subintent?: unknown;
  intent?: unknown;
  category?: unknown;
  confidence?: unknown;
  has_new_request?: unknown;
  conversation_stage?: unknown;
  [key: string]: unknown;
};

type ApprovedResponseRow = {
  caseId: string;
  family: string;
  subintent: string;
  customerExample: string;
  approvedResponse: string;
  mustInclude: unknown;
  mustNotInclude: unknown;
  status: string;
  priority: number;
  source?: string;
};

export type BotKnowledgeInput = {
  external_message_id?: string | null;
  customer_email?: string | null;
  email?: string | null;
  inbound_email?: string | null;
  customer_name?: string | null;
  subject?: string | null;
  message?: string | null;
  current_message?: string | null;
  order_number?: string | null;
  received_at?: string | null;
  reference_date?: string | null;
  classification?: CaseClassification | null;
};

export type BotKnowledge = Awaited<ReturnType<typeof getBotKnowledge>>;

export async function getBotKnowledge(input: BotKnowledgeInput) {
  const email = normalizeEmail(input.customer_email || input.email || input.inbound_email);
  const texts = [
    input.subject,
    input.current_message,
    input.message,
    input.order_number
  ];
  const orderNumberCandidates = extractOrderNumberCandidates(texts);

  // Solo activa la consulta Shopify EN VIVO (fail-open, dentro de getCustomerProfile
  // y solo si la BD no trae pedido de suscripcion relevante) cuando el caso parece de
  // ambito suscripcion/pedido, envio/seguimiento o una queja de promo 3x2 /
  // pedido incompleto; asi el
  // camino comun no anade latencia ni llamadas.
  const liveOrderFetcher =
    looksSubscriptionScope(texts, input.classification) ||
    looksPromoScope(texts) ||
    looksShippingScope(texts, input.classification)
      ? fetchLiveSubscriptionOrders
      : undefined;

  const [customerProfile, previousTickets, approvedResponseCandidates] = await Promise.all([
    getCustomerProfile(
      { email, texts, referenceDate: input.received_at || input.reference_date },
      { liveOrderFetcher }
    ),
    email ? findPreviousTickets(email, input.external_message_id) : Promise.resolve([]),
    findApprovedResponseCandidates(input)
  ]);

  return {
    customer_email: email,
    customer_name: String(input.customer_name || '').trim(),
    order_number_candidates: orderNumberCandidates,
    customer_profile: customerProfile,
    recent_orders: customerProfile.recentOrders,
    order_count: customerProfile.orderCount,
    subscription_order_context: toKnowledgeSubscriptionOrderContext(
      customerProfile.subscriptionOrderContext
    ),
    promo_order_context: toKnowledgePromoOrderContext(customerProfile.promoOrderContext),
    previous_tickets: previousTickets,
    approved_response_candidates: approvedResponseCandidates,
    retrieval: {
      orders_found: customerProfile.orderCount,
      previous_ticket_count: previousTickets.length,
      approved_response_count: approvedResponseCandidates.length,
      used_email_lookup: Boolean(email),
      used_order_number_lookup: orderNumberCandidates.length > 0
    }
  };
}

function looksSubscriptionScope(
  texts: Array<string | null | undefined>,
  classification?: CaseClassification | null
): boolean {
  const text = String(texts.join(' ') || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  const family = String(classification?.family || '').toLowerCase();
  if (family.includes('suscri')) return true;
  // Solo ambito suscripcion/pedido-no-reconocido: evita disparar una consulta
  // Shopify en vivo (latencia en el camino de cada email) en devoluciones/cobros
  // genericos que no se benefician del order-context de suscripcion.
  return /confirmacion de pedido|tu pedido esta confirmado|se actualizo el pedido|suscri|recarga|recurrente|automatic|loop subscriptions|recurrent|no hemos hecho|no he hecho ningun pedido|no hemos realizado|no reconozco (este |ese |el )?pedido|no hemos solicitado|sin (yo )?(haber|solicitar) (pedido|comprado|aceptado)/.test(
    text
  );
}

function looksPromoScope(texts: Array<string | null | undefined>): boolean {
  const text = String(texts.join(' ') || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  // Queja de promo 3x2 / pedido incompleto: dispara el lookup en vivo para verificar
  // si el pedido llevaba la promo (error de almacen) o eran unidades sueltas (error
  // del cliente). Acotado para no llamar a Shopify en menciones genericas de "promo".
  return /\b3\s*x\s*2\b|3 por 2|2\s*\+\s*1|solo (me )?(han |me )?lleg|solo (he|e) recibido|me falta|falta(n)? (una|1|la|el|mi|bolsa|producto)|pedido incompleto|llego incompleto|paquetes en vez|en vez de (los )?(3|tres)/.test(
    text
  );
}

function looksShippingScope(
  texts: Array<string | null | undefined>,
  classification?: CaseClassification | null
): boolean {
  const text = String(texts.join(' ') || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  const classifierText = [
    classification?.family,
    classification?.subintent,
    classification?.intent,
    classification?.category
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

  if (/estado[_ ]?envio|logistica|order[_ ]?status|shipping|tracking|seguimiento/.test(classifierText)) {
    return true;
  }

  const shippingContext =
    /pedido|paquete|envio|entrega|reparto|seguimiento|tracking|transportista/.test(text);
  const shippingRequest =
    /no (me )?(ha|han) llegado|no (lo |la |las |los )?he recibido|sigo sin recibir|sin recibir (el|mi) pedido|todavia no (lo |me )?(he|ha|han)|aun no (me |lo )?(ha|han|he)|en reparto|numero de seguimiento|tracking|donde esta (mi|el) pedido|estado de (mi|el) (pedido|envio)|cuando (me )?(llega|llegara|va a llegar)|fecha de entrega/.test(
      text
    );

  return shippingContext && shippingRequest;
}

function toKnowledgeSubscriptionOrderContext(context: SubscriptionOrderContext) {
  return {
    has_relevant_subscription_order: context.hasRelevantSubscriptionOrder,
    state: context.state,
    subscription_order_state: context.state,
    match_type: context.matchType,
    generated_lookback_days: context.generatedLookbackDays,
    received_lookback_days: context.receivedLookbackDays,
    latest_subscription_order: context.latestSubscriptionOrder,
    ignored_subscription_orders: context.ignoredSubscriptionOrders
  };
}

function toKnowledgePromoOrderContext(context: PromoOrderContext) {
  return {
    matched: context.matched,
    match_type: context.matchType,
    bought_promo_3x2: context.boughtPromo3x2,
    units_ordered: context.unitsOrdered,
    promo_discount_total: context.promoDiscountTotal,
    order_number: context.orderNumber,
    fulfillment_status: context.fulfillmentStatus,
    processed_at: context.processedAt
  };
}

async function findPreviousTickets(email: string, externalMessageId?: string | null) {
  const where: Prisma.TicketWhereInput = {
    customerEmail: {
      equals: email,
      mode: 'insensitive'
    }
  };

  if (externalMessageId) {
    where.externalMessageId = { not: externalMessageId };
  }

  const tickets = await db.ticket.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      externalMessageId: true,
      subject: true,
      receivedAt: true,
      status: true,
      category: true,
      intent: true,
      riskFlags: true,
      aiConfidence: true,
      confidenceLabel: true,
      requiresReview: true,
      originalText: true,
      aiReply: true,
      finalReply: true,
      sentAt: true,
      updatedAt: true
    }
  });

  return tickets.map((ticket) => ({
    id: ticket.id,
    external_message_id: ticket.externalMessageId,
    subject: ticket.subject,
    received_at: ticket.receivedAt.toISOString(),
    status: ticket.status,
    category: ticket.category || '',
    intent: ticket.intent || '',
    risk_flags: ticket.riskFlags || '',
    ai_confidence: ticket.aiConfidence,
    confidence_label: ticket.confidenceLabel || '',
    requires_review: ticket.requiresReview,
    customer_message: snippet(ticket.originalText),
    last_reply: snippet(ticket.finalReply || ticket.aiReply || ''),
    sent_at: ticket.sentAt?.toISOString() || null,
    updated_at: ticket.updatedAt.toISOString()
  }));
}

async function findApprovedResponseCandidates(input: BotKnowledgeInput) {
  const classification = input.classification || {};
  const family = normalizeKey(classification.family);
  const subintent = normalizeKey(classification.subintent);
  const queryText = [input.subject, input.current_message, input.message].join(' ');
  const messageTokens = tokenSet(queryText);
  const queryFeatures = featureSet(queryText);
  const queryNormalized = normalizeKey(queryText).replace(/_/g, ' ');
  const relatedFamilies = getRelatedFamilies(family, queryFeatures, queryNormalized);
  const candidateFamilies = uniqueStrings([
    family,
    ...relatedFamilies,
    family === 'mensaje_simple' ? 'mensaje_simple' : ''
  ]);

  if (!family) {
    return [];
  }

  const where: Prisma.SupportApprovedResponseWhereInput = { status: 'approved' };
  where.OR = candidateFamilies.map((candidateFamily) => ({ family: candidateFamily }));

  let dbRows: ApprovedResponseRow[] = [];
  try {
    const rows = await db.supportApprovedResponse.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
      take: APPROVED_RESPONSE_SCAN_LIMIT
    });
    dbRows = rows.map((row) => ({
      caseId: row.caseId,
      family: row.family,
      subintent: row.subintent,
      customerExample: row.customerExample,
      approvedResponse: row.approvedResponse,
      mustInclude: row.mustInclude,
      mustNotInclude: row.mustNotInclude,
      status: row.status,
      priority: row.priority,
      source: 'db'
    }));
  } catch {
    dbRows = [];
  }

  const memoryRows = getApprovedReplyMemoryRows(candidateFamilies);
  const rows = [...dbRows, ...memoryRows];
  const closing =
    classification.has_new_request === false ||
    normalizeKey(classification.conversation_stage) === 'closing';

  return rows
    .filter((row) => normalizeKey(row.status) === 'approved')
    .map((row) => {
      const rowFamily = normalizeKey(row.family);
      const rowSubintent = normalizeKey(row.subintent);
      const exampleTokens = tokenSet(row.customerExample);
      const rowFeatures = featureSet([row.customerExample, row.approvedResponse].join(' '));
      let score = Number(row.priority || 0);
      let overlap = 0;
      let featureMatches = 0;

      if (family && rowFamily === family) score += 1000;
      else if (relatedFamilies.includes(rowFamily)) score += 540;
      if (subintent && rowSubintent === subintent) score += 700;
      if (closing && rowFamily === 'mensaje_simple') score += 650;
      if (row.source === 'db') score += 40;

      for (const token of exampleTokens) {
        if (messageTokens.has(token)) {
          overlap += 1;
          score += 5;
        }
      }

      for (const feature of rowFeatures) {
        if (queryFeatures.has(feature)) {
          featureMatches += 1;
          score += 35;
        }
      }

      const similarity = jaccard(messageTokens, exampleTokens);
      score += Math.round(similarity * 220);

      const requiredBlocks = Array.isArray(input.classification?.required_blocks)
        ? input.classification.required_blocks.map(String)
        : [];
      if (requiredBlocks.includes('step_by_step_subscription_help')) {
        if (rowFeatures.has('step_by_step_help')) score += 520;
        else score -= 260;
      }
      if (queryFeatures.has('cancel_trouble') && rowFeatures.has('step_by_step_help')) score += 380;
      if (queryFeatures.has('unrequested_order') && rowFeatures.has('subscription')) score += 180;

      const operationalClaim = hasOperationalClaim(row.approvedResponse);
      if (operationalClaim && !queryFeatures.has('operational_status')) {
        score -= 90;
      }

      return { row, score, overlap, featureMatches, similarity };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, APPROVED_RESPONSE_RETURN_LIMIT)
    .map(({ row, score, overlap, featureMatches, similarity }) => ({
      case_id: row.caseId,
      family: row.family,
      subintent: row.subintent,
      customer_example: row.customerExample,
      approved_response: row.approvedResponse,
      must_include: jsonList(row.mustInclude as Prisma.JsonValue | null),
      must_not_include: jsonList(row.mustNotInclude as Prisma.JsonValue | null),
      priority: row.priority,
      source: row.source || 'unknown',
      score,
      overlap,
      feature_matches: featureMatches,
      similarity: Number(similarity.toFixed(3))
    }));
}

function getApprovedReplyMemoryRows(families: string[]): ApprovedResponseRow[] {
  const familySet = new Set(families.map(normalizeKey).filter(Boolean));
  const rawRows = Array.isArray(approvedReplyMemorySeed) ? approvedReplyMemorySeed : [];
  return rawRows
    .map((row) => normalizeApprovedMemoryRow(row))
    .filter((row): row is ApprovedResponseRow => Boolean(row))
    .filter((row) => {
      const rowFamily = normalizeKey(row.family);
      return familySet.has(rowFamily);
    })
    .slice(0, APPROVED_RESPONSE_SCAN_LIMIT);
}

function normalizeApprovedMemoryRow(row: unknown): ApprovedResponseRow | null {
  const value = row as Record<string, unknown>;
  const caseId = String(value.case_id || value.caseId || '').trim();
  const family = normalizeKey(value.family);
  const subintent = normalizeKey(value.subintent);
  const customerExample = String(value.customer_example || value.customerExample || '').trim();
  const approvedResponse = String(value.approved_response || value.approvedResponse || '').trim();

  if (!caseId || !family || !subintent || !customerExample || !approvedResponse) return null;

  return {
    caseId,
    family,
    subintent,
    customerExample,
    approvedResponse,
    mustInclude: value.must_include || value.mustInclude || [],
    mustNotInclude: value.must_not_include || value.mustNotInclude || [],
    status: String(value.status || 'approved'),
    priority: Number(value.priority || 0),
    source: String(value.source || 'approved_reply_memory')
  };
}

function normalizeEmail(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

function snippet(value: string, maxLength = 420) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trim()}...`;
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

function tokenSet(value: string) {
  return new Set(
    normalizeKey(value)
      .split('_')
      .filter((token) => token.length > 3 && !STOPWORDS.has(token))
  );
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function featureSet(value: string) {
  const text = normalizeKey(value).replace(/_/g, ' ');
  const features = new Set<string>();
  const addIf = (feature: string, pattern: RegExp) => {
    if (pattern.test(text)) features.add(feature);
  };

  addIf('subscription', /suscripcion|darme de baja|darse de baja|cancelar/);
  addIf('subscription_link', /loop subscriptions|get subscription link|enlace de baja|link de baja/);
  addIf('return_refund', /devolucion|devolver|reembolso|importe|dinero|abono/);
  addIf('return_address', /azalea|alcobendas|miniparc/);
  addIf('shipping', /envio|entrega|reparto|transportista|tipsa|paquete/);
  addIf('address_change', /direccion|calle|codigo postal|modificar direccion|cambiar direccion/);
  addIf('product_usage', /tomar|dosis|gominola|gummies|desayuno|comida/);
  addIf('product_results', /resultado|efecto|peso|adelgazar|hambre/);
  addIf('product_health', /medico|farmaceutico|embarazo|eutirox|tiroides|alergia|estomago/);
  addIf('closing', /gracias|perfecto|de acuerdo|avisare|informare/);
  addIf('operational_status', /ya hemos|hemos hecho|hemos anulado|hemos actualizado|sale hoy|esta en camino|aun no ha salido/);
  addIf('unrequested_order', /no he pedido|no reconozco|no realice|yo no hice|no hice ningun pedido|cobro no reconocido/);
  addIf('cancel_trouble', /donde cancelo|como cancelo|no lo veo|no encuentro|no puedo cancelar|ayuda.*cancelar|cancelar.*ayuda/);
  addIf('step_by_step_help', /paso a paso|\b1\b.*\b2\b.*\b3\b|introducir.*email|modificar suscripcion|ajustar detalles|cancelar suscripcion/);
  addIf('product_missing', /faltan|falta|incompleto|llegado dos|llegaron dos|promocion|promo|paquetes en vez/);
  addIf('shipping_not_arrived', /no ha llegado|no han llegado|todavia no ha llegado|todavia no han llegado|tardando mucho/);
  addIf('sleep_product', /sleep|sueno|dormir|descansar|descanso|melatonina/);

  return features;
}

function getRelatedFamilies(family: string, queryFeatures: Set<string>, queryNormalized: string) {
  const relatedMap: Record<string, string[]> = {
    pedido_no_reconocido: ['suscripcion_cancelacion', 'cobro_reembolso'],
    suscripcion_cancelacion: ['pedido_no_reconocido', 'cobro_reembolso', 'devolucion_reembolso'],
    cobro_reembolso: ['pedido_no_reconocido', 'suscripcion_cancelacion', 'devolucion_reembolso'],
    devolucion_reembolso: ['suscripcion_cancelacion', 'cobro_reembolso'],
    producto_uso: ['producto_sintomas', 'producto_resultados', 'producto_confianza'],
    producto_sintomas: ['producto_uso', 'producto_resultados'],
    estado_envio: ['producto_uso', 'pedido_no_reconocido']
  };
  const related = relatedMap[family] || [];

  return related.filter((rowFamily) => {
    if ((family === 'pedido_no_reconocido' || rowFamily === 'pedido_no_reconocido') && queryFeatures.has('unrequested_order')) return true;
    if (
      (family === 'suscripcion_cancelacion' || rowFamily === 'suscripcion_cancelacion') &&
      /suscripcion|darme de baja|cancelar|no he pedido|no pedi|no lo pedi|no reconozco|cobro|tarjeta/.test(queryNormalized)
    ) {
      return true;
    }
    if (queryFeatures.has('product_missing') && rowFamily === 'estado_envio') return true;
    if (queryFeatures.has('shipping_not_arrived') && rowFamily === 'estado_envio') return true;
    if (queryFeatures.has('sleep_product') && (rowFamily === 'producto_uso' || rowFamily === 'producto_sintomas')) return true;
    return queryFeatures.has('return_refund') && (rowFamily === 'cobro_reembolso' || rowFamily === 'devolucion_reembolso');
  });
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map(normalizeKey).filter(Boolean))];
}

function hasOperationalClaim(value: string) {
  return /ya\s+(?:hemos|esta|se ha)|hemos\s+(?:hecho|anulado|actualizado|gestionado)|sale hoy|ahora te hacemos/i.test(value);
}

function jsonList(value: Prisma.JsonValue | null) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

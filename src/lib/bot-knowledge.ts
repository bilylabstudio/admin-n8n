import type { Prisma } from '@prisma/client';
import {
  extractOrderNumberCandidates,
  getCustomerProfile,
  type SubscriptionOrderContext
} from './customer-profile';
import { db } from './db';

const HISTORY_LIMIT = 6;
const APPROVED_RESPONSE_SCAN_LIMIT = 30;
const APPROVED_RESPONSE_RETURN_LIMIT = 8;

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

  const [customerProfile, previousTickets, approvedResponseCandidates] = await Promise.all([
    getCustomerProfile({ email, texts, referenceDate: input.received_at || input.reference_date }),
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
  try {
    const classification = input.classification || {};
    const family = normalizeKey(classification.family);
    const subintent = normalizeKey(classification.subintent);
    const where: Prisma.SupportApprovedResponseWhereInput = { status: 'approved' };

    if (family) {
      where.OR = [{ family }, { family: 'mensaje_simple' }];
    }

    const rows = await db.supportApprovedResponse.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
      take: APPROVED_RESPONSE_SCAN_LIMIT
    });

    const messageTokens = tokenSet([input.subject, input.current_message, input.message].join(' '));
    const closing =
      classification.has_new_request === false ||
      normalizeKey(classification.conversation_stage) === 'closing';

    return rows
      .map((row) => {
        const rowFamily = normalizeKey(row.family);
        const rowSubintent = normalizeKey(row.subintent);
        const exampleTokens = tokenSet(row.customerExample);
        let score = Number(row.priority || 0);
        let overlap = 0;

        if (family && rowFamily === family) score += 1000;
        if (subintent && rowSubintent === subintent) score += 700;
        if (closing && rowFamily === 'mensaje_simple') score += 500;

        for (const token of exampleTokens) {
          if (messageTokens.has(token)) {
            overlap += 1;
            score += 2;
          }
        }

        return { row, score, overlap };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, APPROVED_RESPONSE_RETURN_LIMIT)
      .map(({ row, score, overlap }) => ({
        case_id: row.caseId,
        family: row.family,
        subintent: row.subintent,
        customer_example: row.customerExample,
        approved_response: row.approvedResponse,
        must_include: jsonList(row.mustInclude),
        must_not_include: jsonList(row.mustNotInclude),
        priority: row.priority,
        score,
        overlap
      }));
  } catch {
    return [];
  }
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
      .filter((token) => token.length > 3)
  );
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

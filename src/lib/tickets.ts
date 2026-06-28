import { z } from 'zod';
import { db } from './db';
import { canUpdateFromIngest, nextStatusAfterIngest } from './status';

const sentimentSchema = z.enum(['molesto', 'neutral', 'contento']);

export const ingestTicketSchema = z.object({
  external_message_id: z.string().min(1),
  customer_email: z.string().email(),
  customer_name: z.string().optional().default(''),
  subject: z.string().min(1),
  received_at: z.string().datetime(),
  original_text: z.string().min(1),
  ai_reply: z.string().optional().default(''),
  category: z.string().optional().default(''),
  intent: z.string().optional().default(''),
  risk_flags: z.string().optional().default(''),
  escalation_recommended: z.boolean().optional().default(false),
  ai_confidence: z.number().min(0).max(1).optional(),
  confidence_label: z.string().optional().default(''),
  routed_template_id: z.string().optional().default(''),
  route_source: z.string().optional().default(''),
  sentiment: sentimentSchema.nullable().optional(),
  sentiment_source: z.string().optional().default(''),
  requires_review: z.boolean().optional().default(false),
  auto_discard: z.boolean().optional().default(false),
  discard_reason: z.string().optional().default(''),
  case_reasoning: z.unknown().optional(),
  critic: z.unknown().optional(),
  source: z.string().optional().default('webmail'),
  imap_uid: z.string().optional().default(''),
  imap_mailbox: z.string().optional().default(''),
  message_id: z.string().optional().default(''),
  in_reply_to: z.string().optional().default(''),
  references: z.string().optional().default('')
});

export type IngestTicketInput = z.infer<typeof ingestTicketSchema>;

function metricCreateData(input: IngestTicketInput) {
  const sentiment = input.sentiment ?? null;

  return {
    routedTemplateId: input.routed_template_id || null,
    routeSource: input.route_source || null,
    sentiment,
    sentimentSource: sentiment ? input.sentiment_source || null : null
  };
}

function metricUpdateData(input: IngestTicketInput) {
  const sentiment = input.sentiment ?? null;

  return {
    ...(input.routed_template_id ? { routedTemplateId: input.routed_template_id } : {}),
    ...(input.route_source ? { routeSource: input.route_source } : {}),
    ...(sentiment ? { sentiment, sentimentSource: input.sentiment_source || null } : {})
  };
}

export async function ingestTicket(input: IngestTicketInput) {
  const existing = await db.ticket.findUnique({
    where: { externalMessageId: input.external_message_id }
  });

  const autoDiscard = Boolean(input.auto_discard);
  const nextStatus = autoDiscard ? 'discarded' : nextStatusAfterIngest(Boolean(input.ai_reply.trim()));
  const aiReply = autoDiscard ? '' : input.ai_reply;
  const riskFlags = [
    input.risk_flags,
    autoDiscard ? 'auto_discard' : '',
    autoDiscard && input.discard_reason ? `discard_reason:${input.discard_reason}` : ''
  ].filter(Boolean).join(',');

  if (existing && !canUpdateFromIngest(existing.status)) {
    return existing;
  }

  const ticket = await db.ticket.upsert({
    where: { externalMessageId: input.external_message_id },
    update: {
      customerEmail: input.customer_email,
      customerName: input.customer_name,
      subject: input.subject,
      receivedAt: new Date(input.received_at),
      source: input.source,
      originalText: input.original_text,
      aiReply,
      category: input.category,
      intent: input.intent,
      riskFlags,
      escalationRecommended: autoDiscard ? false : input.escalation_recommended,
      aiConfidence: input.ai_confidence ?? null,
      confidenceLabel: input.confidence_label || null,
      ...metricUpdateData(input),
      requiresReview: autoDiscard ? false : input.requires_review,
      caseReasoningJson: input.case_reasoning as never,
      criticJson: input.critic as never,
      imapUid: input.imap_uid || null,
      imapMailbox: input.imap_mailbox || null,
      messageId: input.message_id || null,
      inReplyTo: input.in_reply_to || null,
      references: input.references || null,
      status: nextStatus,
      sendError: null,
      webmailSyncError: null
    },
    create: {
      externalMessageId: input.external_message_id,
      customerEmail: input.customer_email,
      customerName: input.customer_name,
      subject: input.subject,
      receivedAt: new Date(input.received_at),
      source: input.source,
      originalText: input.original_text,
      aiReply,
      category: input.category,
      intent: input.intent,
      riskFlags,
      escalationRecommended: autoDiscard ? false : input.escalation_recommended,
      aiConfidence: input.ai_confidence ?? null,
      confidenceLabel: input.confidence_label || null,
      ...metricCreateData(input),
      requiresReview: autoDiscard ? false : input.requires_review,
      caseReasoningJson: input.case_reasoning as never,
      criticJson: input.critic as never,
      imapUid: input.imap_uid || null,
      imapMailbox: input.imap_mailbox || null,
      messageId: input.message_id || null,
      inReplyTo: input.in_reply_to || null,
      references: input.references || null,
      webmailSyncError: null,
      status: nextStatus
    }
  });

  await db.auditEvent.create({
    data: {
      ticketId: ticket.id,
      eventType: existing ? 'ticket_updated' : 'ticket_ingested',
      beforeStatus: existing?.status,
      afterStatus: ticket.status,
      metadataJson: {
        external_message_id: input.external_message_id,
        source: input.source,
        auto_discard: autoDiscard,
        discard_reason: input.discard_reason || ''
      }
    }
  });

  return ticket;
}

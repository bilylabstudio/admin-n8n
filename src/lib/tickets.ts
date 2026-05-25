import { z } from 'zod';
import { db } from './db';
import { canUpdateFromIngest, nextStatusAfterIngest } from './status';

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
  source: z.string().optional().default('webmail'),
  imap_uid: z.string().optional().default(''),
  imap_mailbox: z.string().optional().default(''),
  message_id: z.string().optional().default(''),
  in_reply_to: z.string().optional().default(''),
  references: z.string().optional().default('')
});

export type IngestTicketInput = z.infer<typeof ingestTicketSchema>;

export async function ingestTicket(input: IngestTicketInput) {
  const existing = await db.ticket.findUnique({
    where: { externalMessageId: input.external_message_id }
  });

  const nextStatus = nextStatusAfterIngest(Boolean(input.ai_reply.trim()));

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
      aiReply: input.ai_reply,
      category: input.category,
      intent: input.intent,
      riskFlags: input.risk_flags,
      escalationRecommended: input.escalation_recommended,
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
      aiReply: input.ai_reply,
      category: input.category,
      intent: input.intent,
      riskFlags: input.risk_flags,
      escalationRecommended: input.escalation_recommended,
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
        source: input.source
      }
    }
  });

  return ticket;
}

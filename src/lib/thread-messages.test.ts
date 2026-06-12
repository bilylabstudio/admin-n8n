import type { Ticket } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ticketToThreadMessages } from './thread-messages';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    externalMessageId: 'external-1',
    customerEmail: 'cliente@example.com',
    customerName: 'Cliente',
    subject: 'RE: Devolucion de dinero',
    receivedAt: new Date('2026-06-03T09:23:00.000Z'),
    source: 'webmail',
    originalText: 'Buenos dias!!!',
    aiReply: 'Respuesta',
    finalReply: 'Respuesta final',
    category: '',
    intent: '',
    riskFlags: '',
    escalationRecommended: false,
    aiConfidence: null,
    confidenceLabel: null,
    routedTemplateId: null,
    routeSource: null,
    sentiment: null,
    sentimentSource: null,
    requiresReview: false,
    caseReasoningJson: null,
    criticJson: null,
    status: 'edited_sent',
    approvedByUserId: null,
    sentAt: new Date('2026-06-03T09:30:00.000Z'),
    providerMessageId: null,
    imapUid: null,
    imapMailbox: null,
    messageId: null,
    inReplyTo: null,
    references: null,
    seenSyncedAt: null,
    answeredSyncedAt: null,
    sentFolderSyncedAt: null,
    webmailSyncError: null,
    sentMessageJson: null,
    sendError: null,
    createdAt: new Date('2026-06-03T09:23:00.000Z'),
    updatedAt: new Date('2026-06-03T09:30:00.000Z'),
    ...overrides
  };
}

describe('ticketToThreadMessages', () => {
  it('does not show ticket status on inbound customer messages', () => {
    const messages = ticketToThreadMessages(ticket({ status: 'edited_sent' }));

    expect(messages[0]).toMatchObject({
      direction: 'inbound',
      status: null
    });
  });

  it('keeps sent status on outbound admin messages', () => {
    const messages = ticketToThreadMessages(ticket({ status: 'edited_sent' }));

    expect(messages[1]).toMatchObject({
      direction: 'outbound',
      status: 'edited_sent'
    });
  });
});

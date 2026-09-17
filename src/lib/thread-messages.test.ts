import type { Ticket } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { storedThreadMessageToView, ticketToThreadMessages } from './thread-messages';
import type { ThreadMessage } from '@prisma/client';

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

  it('defaults to an empty attachments array when none are supplied', () => {
    const messages = ticketToThreadMessages(ticket({ status: 'edited_sent' }));

    expect(messages[0].attachments).toEqual([]);
    expect(messages[1].attachments).toEqual([]);
  });

  it('routes inbound and outbound attachments to the matching bubble', () => {
    const inboundAttachment = {
      id: 'att-1',
      filename: 'foto.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      direction: 'inbound' as const
    };
    const outboundAttachment = {
      id: 'att-2',
      filename: 'factura.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      direction: 'outbound' as const
    };

    const messages = ticketToThreadMessages(ticket({ status: 'edited_sent' }), {
      'ticket-1': [inboundAttachment, outboundAttachment]
    });

    expect(messages[0].attachments).toEqual([inboundAttachment]);
    expect(messages[1].attachments).toEqual([outboundAttachment]);
  });
});

describe('storedThreadMessageToView', () => {
  function threadMessage(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
    return {
      id: 'thread-1',
      customerEmail: 'cliente@example.com',
      customerName: 'Cliente',
      ticketId: 'ticket-1',
      direction: 'outbound',
      source: 'admin',
      subject: 'RE: Devolucion de dinero',
      text: 'Seguimiento',
      messageAt: new Date('2026-06-04T09:00:00.000Z'),
      messageId: null,
      imapUid: null,
      imapMailbox: null,
      providerMessageId: null,
      rawJson: null,
      createdAt: new Date('2026-06-04T09:00:00.000Z'),
      updatedAt: new Date('2026-06-04T09:00:00.000Z'),
      ...overrides
    };
  }

  it('defaults to an empty attachments array when none are supplied', () => {
    const view = storedThreadMessageToView(threadMessage());
    expect(view.attachments).toEqual([]);
  });

  it('attaches the matching attachments by thread message id', () => {
    const attachment = {
      id: 'att-3',
      filename: 'foto.png',
      mimeType: 'image/png',
      sizeBytes: 512,
      direction: 'outbound' as const
    };
    const view = storedThreadMessageToView(threadMessage(), { 'thread-1': [attachment] });
    expect(view.attachments).toEqual([attachment]);
  });
});


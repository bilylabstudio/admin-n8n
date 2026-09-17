import { readFile } from 'fs/promises';
import type { TicketAttachment } from '@prisma/client';
import { db } from './db';
import { absolutePathFor, TICKET_ATTACHMENT_TOTAL_MAX_BYTES } from './ticket-attachments';

export type OutgoingAttachment = {
  filename: string;
  mime_type: string;
  content_base64: string;
};

export class AttachmentSendError extends Error {
  constructor(public code: AttachmentSendErrorCode) {
    super(code);
    this.name = 'AttachmentSendError';
  }
}

export type AttachmentSendErrorCode =
  | 'attachment_not_found'
  | 'attachment_already_sent'
  | 'attachment_not_outbound'
  | 'attachment_ticket_mismatch'
  | 'total_size_exceeded';

/**
 * Loads previously staged attachments (created via POST /api/attachments)
 * and base64-encodes their content for the n8n send payload. Throws
 * AttachmentSendError if any id is unknown, already sent, or doesn't
 * belong to one of the caller-supplied allowed tickets — a send route
 * should treat that as a 400/403, not silently drop the attachment.
 */
export async function loadStagedAttachmentsForSend(
  attachmentIds: string[],
  allowedTicketIds: string[]
): Promise<{ rows: TicketAttachment[]; payload: OutgoingAttachment[] }> {
  const ids = Array.from(new Set(attachmentIds.filter(Boolean)));
  if (!ids.length) return { rows: [], payload: [] };

  const rows = await db.ticketAttachment.findMany({ where: { id: { in: ids } } });
  if (rows.length !== ids.length) {
    throw new AttachmentSendError('attachment_not_found');
  }

  const allowed = new Set(allowedTicketIds);
  for (const row of rows) {
    if (row.sentAt) throw new AttachmentSendError('attachment_already_sent');
    if (row.direction !== 'outbound' || row.source !== 'admin') {
      throw new AttachmentSendError('attachment_not_outbound');
    }
    if (!row.ticketId || !allowed.has(row.ticketId)) {
      throw new AttachmentSendError('attachment_ticket_mismatch');
    }
  }

  const totalBytes = rows.reduce((sum, row) => sum + row.sizeBytes, 0);
  if (totalBytes > TICKET_ATTACHMENT_TOTAL_MAX_BYTES) {
    throw new AttachmentSendError('total_size_exceeded');
  }

  const payload: OutgoingAttachment[] = [];
  for (const row of rows) {
    const buffer = await readFile(absolutePathFor(row.storagePath));
    payload.push({
      filename: row.filename,
      mime_type: row.mimeType,
      content_base64: buffer.toString('base64')
    });
  }

  return { rows, payload };
}

/**
 * Locks staged attachments once the send actually succeeded. For a
 * follow-up message, threadMessageId links them to the ThreadMessage row
 * created right after send; for a ticket-approval reply, the ticketId set
 * at staging time is already the right home, so threadMessageId stays unset.
 */
export async function markAttachmentsSent(
  attachmentIds: string[],
  options: { sentAt: Date; threadMessageId?: string }
): Promise<void> {
  const ids = attachmentIds.filter(Boolean);
  if (!ids.length) return;

  await db.ticketAttachment.updateMany({
    where: { id: { in: ids } },
    data: {
      sentAt: options.sentAt,
      ...(options.threadMessageId ? { threadMessageId: options.threadMessageId } : {})
    }
  });
}

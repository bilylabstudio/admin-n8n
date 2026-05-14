import type { AuditEventType, Prisma, TicketStatus } from '@prisma/client';
import { db } from './db';

type AuditInput = {
  ticketId?: string;
  userId?: string;
  eventType: AuditEventType;
  beforeStatus?: TicketStatus;
  afterStatus?: TicketStatus;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAuditEvent(input: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      ticketId: input.ticketId,
      userId: input.userId,
      eventType: input.eventType,
      beforeStatus: input.beforeStatus,
      afterStatus: input.afterStatus,
      metadataJson: input.metadata ?? undefined
    }
  });
}

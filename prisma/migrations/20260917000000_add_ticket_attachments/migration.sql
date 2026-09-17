-- Add TicketAttachment: file attachments on inbound/outbound email messages.
-- Points at either a Ticket (the ticket's own inbound message, or the
-- outbound reply that approves it) or a ThreadMessage (an outbound follow-up).
CREATE TABLE "TicketAttachment" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT,
  "threadMessageId" TEXT,
  "direction" "ThreadMessageDirection" NOT NULL,
  "source" "ThreadMessageSource" NOT NULL,
  "filename" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "uploadedByUserId" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketAttachment_ticketId_idx"
  ON "TicketAttachment"("ticketId");

CREATE INDEX "TicketAttachment_threadMessageId_idx"
  ON "TicketAttachment"("threadMessageId");

ALTER TABLE "TicketAttachment"
  ADD CONSTRAINT "TicketAttachment_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketAttachment"
  ADD CONSTRAINT "TicketAttachment_threadMessageId_fkey"
  FOREIGN KEY ("threadMessageId") REFERENCES "ThreadMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketAttachment"
  ADD CONSTRAINT "TicketAttachment_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


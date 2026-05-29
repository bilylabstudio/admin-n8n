-- Add a small append-only thread table for support follow-up messages.
CREATE TYPE "ThreadMessageDirection" AS ENUM ('inbound', 'outbound');
CREATE TYPE "ThreadMessageSource" AS ENUM ('admin', 'webmail');

CREATE TABLE "ThreadMessage" (
  "id" TEXT NOT NULL,
  "customerEmail" TEXT NOT NULL,
  "customerName" TEXT,
  "ticketId" TEXT,
  "direction" "ThreadMessageDirection" NOT NULL,
  "source" "ThreadMessageSource" NOT NULL,
  "subject" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "messageAt" TIMESTAMP(3) NOT NULL,
  "messageId" TEXT,
  "imapUid" TEXT,
  "imapMailbox" TEXT,
  "providerMessageId" TEXT,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ThreadMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ThreadMessage_customerEmail_messageAt_idx"
  ON "ThreadMessage"("customerEmail", "messageAt");

CREATE INDEX "ThreadMessage_ticketId_idx"
  ON "ThreadMessage"("ticketId");

CREATE UNIQUE INDEX "ThreadMessage_imapMailbox_imapUid_key"
  ON "ThreadMessage"("imapMailbox", "imapUid");

ALTER TABLE "ThreadMessage"
  ADD CONSTRAINT "ThreadMessage_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

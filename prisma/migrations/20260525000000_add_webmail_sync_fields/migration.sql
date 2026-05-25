ALTER TABLE "Ticket"
ADD COLUMN "imapUid" TEXT,
ADD COLUMN "imapMailbox" TEXT,
ADD COLUMN "messageId" TEXT,
ADD COLUMN "inReplyTo" TEXT,
ADD COLUMN "references" TEXT,
ADD COLUMN "seenSyncedAt" TIMESTAMP(3),
ADD COLUMN "answeredSyncedAt" TIMESTAMP(3),
ADD COLUMN "sentFolderSyncedAt" TIMESTAMP(3),
ADD COLUMN "webmailSyncError" TEXT,
ADD COLUMN "sentMessageJson" JSONB;

CREATE INDEX "Ticket_imapMailbox_imapUid_idx" ON "Ticket"("imapMailbox", "imapUid");
CREATE INDEX "Ticket_seenSyncedAt_idx" ON "Ticket"("seenSyncedAt");
CREATE INDEX "Ticket_answeredSyncedAt_idx" ON "Ticket"("answeredSyncedAt");

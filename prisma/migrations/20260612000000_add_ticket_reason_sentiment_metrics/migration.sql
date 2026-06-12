ALTER TABLE "Ticket" ADD COLUMN "routedTemplateId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "routeSource" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "sentiment" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "sentimentSource" TEXT;

CREATE INDEX "Ticket_receivedAt_idx" ON "Ticket"("receivedAt");
CREATE INDEX "Ticket_routedTemplateId_receivedAt_idx" ON "Ticket"("routedTemplateId", "receivedAt");
CREATE INDEX "Ticket_routeSource_receivedAt_idx" ON "Ticket"("routeSource", "receivedAt");
CREATE INDEX "Ticket_sentiment_receivedAt_idx" ON "Ticket"("sentiment", "receivedAt");

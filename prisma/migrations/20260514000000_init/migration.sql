-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('new', 'ai_generated', 'pending_review', 'approved_sent', 'edited_sent', 'discarded', 'manual', 'send_failed');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('ticket_ingested', 'ticket_updated', 'approved_sent', 'edited_sent', 'discarded', 'manual', 'send_failed', 'login', 'logout');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'webmail',
    "originalText" TEXT NOT NULL,
    "aiReply" TEXT NOT NULL,
    "finalReply" TEXT,
    "category" TEXT,
    "intent" TEXT,
    "riskFlags" TEXT,
    "escalationRecommended" BOOLEAN NOT NULL DEFAULT false,
    "status" "TicketStatus" NOT NULL DEFAULT 'pending_review',
    "approvedByUserId" TEXT,
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "sendError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "userId" TEXT,
    "eventType" "AuditEventType" NOT NULL,
    "beforeStatus" "TicketStatus",
    "afterStatus" "TicketStatus",
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_externalMessageId_key" ON "Ticket"("externalMessageId");

-- CreateIndex
CREATE INDEX "Ticket_status_receivedAt_idx" ON "Ticket"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "Ticket_customerEmail_idx" ON "Ticket"("customerEmail");

-- CreateIndex
CREATE INDEX "AuditEvent_ticketId_createdAt_idx" ON "AuditEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

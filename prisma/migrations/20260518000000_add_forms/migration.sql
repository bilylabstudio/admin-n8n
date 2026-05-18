-- CreateEnum
CREATE TYPE "FormType" AS ENUM ('devolucion');

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('pending', 'submitted', 'approved_sent', 'rejected_sent', 'manual', 'discarded');

-- AlterEnum: extend AuditEventType with form_* values
ALTER TYPE "AuditEventType" ADD VALUE 'form_minted';
ALTER TYPE "AuditEventType" ADD VALUE 'form_submitted';
ALTER TYPE "AuditEventType" ADD VALUE 'form_approved_sent';
ALTER TYPE "AuditEventType" ADD VALUE 'form_rejected_sent';
ALTER TYPE "AuditEventType" ADD VALUE 'form_manual';
ALTER TYPE "AuditEventType" ADD VALUE 'form_discarded';

-- AlterTable: AuditEvent gains formId
ALTER TABLE "AuditEvent" ADD COLUMN "formId" TEXT;

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" "FormType" NOT NULL DEFAULT 'devolucion',
    "ticketId" TEXT,
    "customerEmail" TEXT NOT NULL,
    "orderNumber" TEXT,
    "purchaseEmail" TEXT,
    "reason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "status" "FormStatus" NOT NULL DEFAULT 'pending',
    "reviewNotes" TEXT,
    "finalReply" TEXT,
    "approvedByUserId" TEXT,
    "sentAt" TIMESTAMP(3),
    "sendError" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormImage" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FormSubmission_token_key" ON "FormSubmission"("token");

-- CreateIndex
CREATE INDEX "FormSubmission_status_submittedAt_idx" ON "FormSubmission"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "FormSubmission_ticketId_idx" ON "FormSubmission"("ticketId");

-- CreateIndex
CREATE INDEX "FormImage_formId_idx" ON "FormImage"("formId");

-- CreateIndex
CREATE INDEX "AuditEvent_formId_createdAt_idx" ON "AuditEvent"("formId", "createdAt");

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormImage" ADD CONSTRAINT "FormImage_formId_fkey" FOREIGN KEY ("formId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_formId_fkey" FOREIGN KEY ("formId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

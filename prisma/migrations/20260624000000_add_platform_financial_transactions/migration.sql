-- CreateTable
CREATE TABLE "PlatformFinancialTransaction" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalTransactionId" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "orderNumber" TEXT,
    "currency" TEXT NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "feeAmount" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "transactionType" TEXT,
    "transactionStatus" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "rawJson" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformFinancialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformFinancialTransaction_provider_externalTransactionId_key" ON "PlatformFinancialTransaction"("provider", "externalTransactionId");

-- CreateIndex
CREATE INDEX "PlatformFinancialTransaction_platform_postedAt_idx" ON "PlatformFinancialTransaction"("platform", "postedAt");

-- CreateIndex
CREATE INDEX "PlatformFinancialTransaction_provider_postedAt_idx" ON "PlatformFinancialTransaction"("provider", "postedAt");

-- CreateIndex
CREATE INDEX "PlatformFinancialTransaction_externalOrderId_idx" ON "PlatformFinancialTransaction"("externalOrderId");

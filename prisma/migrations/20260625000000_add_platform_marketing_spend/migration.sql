-- CreateTable
CREATE TABLE "PlatformMarketingSpend" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalRecordId" TEXT NOT NULL,
    "reportType" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "currency" TEXT NOT NULL,
    "spendAmount" DECIMAL(12,2) NOT NULL,
    "attributedSalesAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL,
    "rawJson" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformMarketingSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformMarketingSpend_provider_externalRecordId_key" ON "PlatformMarketingSpend"("provider", "externalRecordId");

-- CreateIndex
CREATE INDEX "PlatformMarketingSpend_platform_date_idx" ON "PlatformMarketingSpend"("platform", "date");

-- CreateIndex
CREATE INDEX "PlatformMarketingSpend_provider_date_idx" ON "PlatformMarketingSpend"("provider", "date");

-- CreateIndex
CREATE INDEX "PlatformMarketingSpend_campaignId_date_idx" ON "PlatformMarketingSpend"("campaignId", "date");


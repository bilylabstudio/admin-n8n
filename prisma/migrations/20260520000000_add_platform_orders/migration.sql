-- CreateTable
CREATE TABLE "PlatformOrder" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "currency" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL,
    "financialStatus" TEXT NOT NULL,
    "fulfillmentStatus" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "totalTax" DECIMAL(12,2) NOT NULL,
    "totalShipping" DECIMAL(12,2) NOT NULL,
    "totalDiscounts" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "totalRefunded" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalUnits" INTEGER NOT NULL,
    "customerEmail" TEXT,
    "countryCode" TEXT,
    "channel" TEXT,
    "rawJson" JSONB,
    "externalUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSyncState" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "lastUpdatedAt" TIMESTAMP(3),
    "lastSyncRunAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "ordersImported" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlatformSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformOrder_platform_externalOrderId_key" ON "PlatformOrder"("platform", "externalOrderId");

-- CreateIndex
CREATE INDEX "PlatformOrder_platform_processedAt_idx" ON "PlatformOrder"("platform", "processedAt");

-- CreateIndex
CREATE INDEX "PlatformOrder_processedAt_idx" ON "PlatformOrder"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSyncState_platform_key" ON "PlatformSyncState"("platform");

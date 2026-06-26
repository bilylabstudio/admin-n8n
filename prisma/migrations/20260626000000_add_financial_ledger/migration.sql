-- CreateTable
CREATE TABLE "FinancialLedgerEntry" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialSetting" (
    "key" TEXT NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialLedgerEntry_month_periodLabel_lineKey_key" ON "FinancialLedgerEntry"("month", "periodLabel", "lineKey");

-- CreateIndex
CREATE INDEX "FinancialLedgerEntry_month_idx" ON "FinancialLedgerEntry"("month");

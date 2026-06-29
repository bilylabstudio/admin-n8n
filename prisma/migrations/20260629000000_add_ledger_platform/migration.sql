-- FinancialLedgerEntry: anadir platform y re-scopear unique/index por plataforma.
ALTER TABLE "FinancialLedgerEntry" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'shopify';

DROP INDEX "FinancialLedgerEntry_month_periodLabel_lineKey_key";
DROP INDEX "FinancialLedgerEntry_month_idx";

CREATE UNIQUE INDEX "FinancialLedgerEntry_platform_month_periodLabel_lineKey_key" ON "FinancialLedgerEntry"("platform", "month", "periodLabel", "lineKey");
CREATE INDEX "FinancialLedgerEntry_platform_month_idx" ON "FinancialLedgerEntry"("platform", "month");

-- FinancialSetting: anadir platform y clave primaria compuesta (platform, key).
ALTER TABLE "FinancialSetting" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'shopify';
ALTER TABLE "FinancialSetting" DROP CONSTRAINT "FinancialSetting_pkey";
ALTER TABLE "FinancialSetting" ADD CONSTRAINT "FinancialSetting_pkey" PRIMARY KEY ("platform", "key");

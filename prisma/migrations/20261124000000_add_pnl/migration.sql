-- P&L del panel de negocio (tablas nuevas, no modifica nada existente).
CREATE TABLE "PnlRule" (
    "platform" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PnlRule_pkey" PRIMARY KEY ("platform","key")
);

CREATE TABLE "PnlActual" (
    "platform" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PnlActual_pkey" PRIMARY KEY ("platform","month","key")
);

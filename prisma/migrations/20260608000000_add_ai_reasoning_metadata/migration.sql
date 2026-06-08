ALTER TABLE "Ticket"
ADD COLUMN "aiConfidence" DOUBLE PRECISION,
ADD COLUMN "confidenceLabel" TEXT,
ADD COLUMN "requiresReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "caseReasoningJson" JSONB,
ADD COLUMN "criticJson" JSONB;

CREATE TABLE "support_approved_responses" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "family" TEXT NOT NULL,
  "subintent" TEXT NOT NULL,
  "customer_example" TEXT NOT NULL,
  "approved_response" TEXT NOT NULL,
  "must_include" JSONB,
  "must_not_include" JSONB,
  "status" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "support_approved_responses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_approved_responses_case_id_key"
ON "support_approved_responses"("case_id");

CREATE INDEX "support_approved_responses_status_family_subintent_idx"
ON "support_approved_responses"("status", "family", "subintent");

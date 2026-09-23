-- CreateEnum
CREATE TYPE "DncnType" AS ENUM ('Debit', 'Credit');

-- AlterTable
ALTER TABLE "sys_budget_category" ADD COLUMN     "allows_dncn" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "fin_dncn" (
    "id" SERIAL NOT NULL,
    "note_no" TEXT NOT NULL,
    "note_type" "DncnType" NOT NULL,
    "document_date" DATE,
    "posting_date" TIMESTAMPTZ(6),
    "company_id" INTEGER NOT NULL,
    "budget_category_id" INTEGER NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "exchange_rate" DECIMAL(18,6),
    "note_amount" DECIMAL(18,2) NOT NULL,
    "note_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "note" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'Draft',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_dncn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_dncn_line" (
    "id" SERIAL NOT NULL,
    "note_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_dncn_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_dncn_note_no_key" ON "fin_dncn"("note_no");

-- CreateIndex
CREATE INDEX "fin_dncn_company_id_idx" ON "fin_dncn"("company_id");

-- CreateIndex
CREATE INDEX "fin_dncn_partner_id_idx" ON "fin_dncn"("partner_id");

-- CreateIndex
CREATE INDEX "fin_dncn_status_idx" ON "fin_dncn"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fin_dncn_line_note_id_sequence_no_key" ON "fin_dncn_line"("note_id", "sequence_no");

-- AddForeignKey
ALTER TABLE "fin_dncn" ADD CONSTRAINT "fin_dncn_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_dncn" ADD CONSTRAINT "fin_dncn_budget_category_id_fkey" FOREIGN KEY ("budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_dncn" ADD CONSTRAINT "fin_dncn_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_dncn" ADD CONSTRAINT "fin_dncn_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_dncn_line" ADD CONSTRAINT "fin_dncn_line_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "fin_dncn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A Debit / Credit Note adjusts a subject book, so only a category that keeps
-- one may allow it: it must name a Partner and say which way its book runs.
-- The Server Action refuses the same thing by name; this is the backstop.
ALTER TABLE "sys_budget_category"
  ADD CONSTRAINT "sys_budget_category_dncn_needs_book"
  CHECK ("allows_dncn" = false OR ("require_partner" = true AND "raises" IS NOT NULL));

-- One-time backfill for databases seeded before the column existed. The three
-- books a single Profit & Loss counter account adjusts correctly — a deposit
-- held, a payable and a receivable. Prive, Investasi and Hasil Investasi stay
-- off: their counter entry is not an income or an expense. From here on the
-- flag is the category's own, set on its form.
UPDATE "sys_budget_category"
SET "allows_dncn" = true
WHERE "category_label" IN ('Titipan', 'Hutang', 'Piutang')
  AND "require_partner" = true
  AND "raises" IS NOT NULL;

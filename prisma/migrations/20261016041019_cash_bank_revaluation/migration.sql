-- AlterEnum
ALTER TYPE "CashBankEntryType" ADD VALUE 'Revaluation';

-- CreateTable
CREATE TABLE "fin_cash_bank_revaluation" (
    "id" SERIAL NOT NULL,
    "revaluation_no" TEXT NOT NULL,
    "document_date" DATE,
    "posting_date" TIMESTAMPTZ(6),
    "company_id" INTEGER NOT NULL,
    "cash_bank_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL,
    "foreign_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_before" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_after" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "opened_layer_id" INTEGER,
    "note" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'Draft',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_cash_bank_revaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_cash_bank_revaluation_layer" (
    "id" SERIAL NOT NULL,
    "revaluation_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "cash_bank_layer_id" INTEGER NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "foreign_amount" DECIMAL(18,2) NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_cash_bank_revaluation_layer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_bank_revaluation_revaluation_no_key" ON "fin_cash_bank_revaluation"("revaluation_no");

-- CreateIndex
CREATE INDEX "fin_cash_bank_revaluation_company_id_idx" ON "fin_cash_bank_revaluation"("company_id");

-- CreateIndex
CREATE INDEX "fin_cash_bank_revaluation_cash_bank_id_idx" ON "fin_cash_bank_revaluation"("cash_bank_id");

-- CreateIndex
CREATE INDEX "fin_cash_bank_revaluation_status_idx" ON "fin_cash_bank_revaluation"("status");

-- CreateIndex
CREATE INDEX "fin_cash_bank_revaluation_layer_revaluation_id_idx" ON "fin_cash_bank_revaluation_layer"("revaluation_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_bank_revaluation_layer_cash_bank_layer_id_key" ON "fin_cash_bank_revaluation_layer"("cash_bank_layer_id");

-- AddForeignKey
ALTER TABLE "fin_cash_bank_revaluation" ADD CONSTRAINT "fin_cash_bank_revaluation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_revaluation" ADD CONSTRAINT "fin_cash_bank_revaluation_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_revaluation" ADD CONSTRAINT "fin_cash_bank_revaluation_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_revaluation_layer" ADD CONSTRAINT "fin_cash_bank_revaluation_layer_revaluation_id_fkey" FOREIGN KEY ("revaluation_id") REFERENCES "fin_cash_bank_revaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

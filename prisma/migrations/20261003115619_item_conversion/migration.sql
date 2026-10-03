-- AlterEnum
ALTER TYPE "SubLedgerEntryType" ADD VALUE 'Conversion';

-- CreateTable
CREATE TABLE "fin_item_conversion" (
    "id" SERIAL NOT NULL,
    "conversion_no" TEXT NOT NULL,
    "document_date" DATE,
    "posting_date" TIMESTAMPTZ(6),
    "company_id" INTEGER NOT NULL,
    "from_cash_bank_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "cash_bank_layer_id" INTEGER NOT NULL,
    "budget_category_id" INTEGER NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "conversion_amount" DECIMAL(18,2) NOT NULL,
    "conversion_base_amount" DECIMAL(18,2) NOT NULL,
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'Draft',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_item_conversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_item_conversion_line" (
    "id" SERIAL NOT NULL,
    "conversion_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "to_cash_bank_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL,
    "out_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "in_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "opened_item_id" INTEGER,
    "cash_fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "item_fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_item_conversion_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_item_conversion_line_item" (
    "id" SERIAL NOT NULL,
    "line_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "sub_ledger_balance_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "settlement_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "converted_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_item_conversion_line_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_item_conversion_conversion_no_key" ON "fin_item_conversion"("conversion_no");

-- CreateIndex
CREATE INDEX "fin_item_conversion_company_id_idx" ON "fin_item_conversion"("company_id");

-- CreateIndex
CREATE INDEX "fin_item_conversion_partner_id_idx" ON "fin_item_conversion"("partner_id");

-- CreateIndex
CREATE INDEX "fin_item_conversion_status_idx" ON "fin_item_conversion"("status");

-- CreateIndex
CREATE INDEX "fin_item_conversion_line_to_cash_bank_id_idx" ON "fin_item_conversion_line"("to_cash_bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_item_conversion_line_conversion_id_sequence_no_key" ON "fin_item_conversion_line"("conversion_id", "sequence_no");

-- CreateIndex
CREATE INDEX "fin_item_conversion_line_item_sub_ledger_balance_id_idx" ON "fin_item_conversion_line_item"("sub_ledger_balance_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_item_conversion_line_item_line_id_sub_ledger_balance_id_key" ON "fin_item_conversion_line_item"("line_id", "sub_ledger_balance_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_item_conversion_line_item_line_id_sequence_no_key" ON "fin_item_conversion_line_item"("line_id", "sequence_no");

-- AddForeignKey
ALTER TABLE "fin_item_conversion" ADD CONSTRAINT "fin_item_conversion_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_conversion" ADD CONSTRAINT "fin_item_conversion_from_cash_bank_id_fkey" FOREIGN KEY ("from_cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_conversion" ADD CONSTRAINT "fin_item_conversion_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_conversion" ADD CONSTRAINT "fin_item_conversion_budget_category_id_fkey" FOREIGN KEY ("budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_conversion" ADD CONSTRAINT "fin_item_conversion_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_conversion_line" ADD CONSTRAINT "fin_item_conversion_line_conversion_id_fkey" FOREIGN KEY ("conversion_id") REFERENCES "fin_item_conversion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_conversion_line" ADD CONSTRAINT "fin_item_conversion_line_to_cash_bank_id_fkey" FOREIGN KEY ("to_cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_conversion_line_item" ADD CONSTRAINT "fin_item_conversion_line_item_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "fin_item_conversion_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backstops under the rules the Server Action enforces: a line and an item
-- convert something, and the kurs is always an input.
ALTER TABLE "fin_item_conversion_line" ADD CONSTRAINT "fin_item_conversion_line_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "fin_item_conversion_line" ADD CONSTRAINT "fin_item_conversion_line_rate_positive" CHECK ("exchange_rate" > 0);
ALTER TABLE "fin_item_conversion_line_item" ADD CONSTRAINT "fin_item_conversion_line_item_amount_positive" CHECK ("amount" > 0);

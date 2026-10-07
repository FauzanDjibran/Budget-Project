-- AlterEnum
ALTER TYPE "SubLedgerEntryType" ADD VALUE 'Reclass';

-- CreateTable
CREATE TABLE "fin_item_reclass" (
    "id" SERIAL NOT NULL,
    "reclass_no" TEXT NOT NULL,
    "document_date" DATE,
    "posting_date" TIMESTAMPTZ(6),
    "company_id" INTEGER NOT NULL,
    "budget_category_id" INTEGER NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "reclass_amount" DECIMAL(18,2) NOT NULL,
    "reclass_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'Draft',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_item_reclass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_item_reclass_line" (
    "id" SERIAL NOT NULL,
    "reclass_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "target_budget_category_id" INTEGER NOT NULL,
    "target_partner_id" INTEGER NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "released_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_item_reclass_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_item_reclass_line_source" (
    "id" SERIAL NOT NULL,
    "line_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "sub_ledger_balance_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "released_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "opened_item_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_item_reclass_line_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_item_reclass_line_target" (
    "id" SERIAL NOT NULL,
    "line_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "sub_ledger_balance_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "allocated_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "settlement_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_item_reclass_line_target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_item_reclass_reclass_no_key" ON "fin_item_reclass"("reclass_no");

-- CreateIndex
CREATE INDEX "fin_item_reclass_company_id_idx" ON "fin_item_reclass"("company_id");

-- CreateIndex
CREATE INDEX "fin_item_reclass_partner_id_idx" ON "fin_item_reclass"("partner_id");

-- CreateIndex
CREATE INDEX "fin_item_reclass_status_idx" ON "fin_item_reclass"("status");

-- CreateIndex
CREATE INDEX "fin_item_reclass_line_target_partner_id_idx" ON "fin_item_reclass_line"("target_partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_item_reclass_line_reclass_id_sequence_no_key" ON "fin_item_reclass_line"("reclass_id", "sequence_no");

-- CreateIndex
CREATE INDEX "fin_item_reclass_line_source_sub_ledger_balance_id_idx" ON "fin_item_reclass_line_source"("sub_ledger_balance_id");

-- CreateIndex
CREATE INDEX "fin_item_reclass_line_source_opened_item_id_idx" ON "fin_item_reclass_line_source"("opened_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_item_reclass_line_source_line_id_sub_ledger_balance_id_key" ON "fin_item_reclass_line_source"("line_id", "sub_ledger_balance_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_item_reclass_line_source_line_id_sequence_no_key" ON "fin_item_reclass_line_source"("line_id", "sequence_no");

-- CreateIndex
CREATE INDEX "fin_item_reclass_line_target_sub_ledger_balance_id_idx" ON "fin_item_reclass_line_target"("sub_ledger_balance_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_item_reclass_line_target_line_id_sub_ledger_balance_id_key" ON "fin_item_reclass_line_target"("line_id", "sub_ledger_balance_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_item_reclass_line_target_line_id_sequence_no_key" ON "fin_item_reclass_line_target"("line_id", "sequence_no");

-- AddForeignKey
ALTER TABLE "fin_item_reclass" ADD CONSTRAINT "fin_item_reclass_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_reclass" ADD CONSTRAINT "fin_item_reclass_budget_category_id_fkey" FOREIGN KEY ("budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_reclass" ADD CONSTRAINT "fin_item_reclass_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_reclass" ADD CONSTRAINT "fin_item_reclass_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_reclass_line" ADD CONSTRAINT "fin_item_reclass_line_reclass_id_fkey" FOREIGN KEY ("reclass_id") REFERENCES "fin_item_reclass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_reclass_line" ADD CONSTRAINT "fin_item_reclass_line_target_budget_category_id_fkey" FOREIGN KEY ("target_budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_reclass_line" ADD CONSTRAINT "fin_item_reclass_line_target_partner_id_fkey" FOREIGN KEY ("target_partner_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_reclass_line_source" ADD CONSTRAINT "fin_item_reclass_line_source_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "fin_item_reclass_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_item_reclass_line_target" ADD CONSTRAINT "fin_item_reclass_line_target_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "fin_item_reclass_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backstops under the rules the Server Action enforces: a line and every item
-- it names move something.
ALTER TABLE "fin_item_reclass_line" ADD CONSTRAINT "fin_item_reclass_line_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "fin_item_reclass_line_source" ADD CONSTRAINT "fin_item_reclass_line_source_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "fin_item_reclass_line_target" ADD CONSTRAINT "fin_item_reclass_line_target_amount_positive" CHECK ("amount" > 0);

-- CreateEnum
CREATE TYPE "SubLedgerEntryType" AS ENUM ('Opening', 'Transaction', 'Adjustment');

-- CreateTable
CREATE TABLE "sub_ledger" (
    "id" SERIAL NOT NULL,
    "entry_no" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "entry_date" DATE NOT NULL,
    "entry_type" "SubLedgerEntryType" NOT NULL,
    "direction" "FlowDirection" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "movement" DECIMAL(18,2) NOT NULL,
    "balance_after" DECIMAL(18,2) NOT NULL,
    "source_doc_type_id" INTEGER,
    "source_doc_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sub_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_ledger_balance" (
    "id" SERIAL NOT NULL,
    "book" TEXT NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "entry_count" INTEGER NOT NULL DEFAULT 0,
    "last_entry_id" INTEGER,
    "last_entry_date" DATE,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sub_ledger_balance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sub_ledger_entry_no_key" ON "sub_ledger"("entry_no");

-- CreateIndex
CREATE INDEX "sub_ledger_book_partner_id_entry_date_idx" ON "sub_ledger"("book", "partner_id", "entry_date");

-- CreateIndex
CREATE INDEX "sub_ledger_source_doc_type_id_source_doc_id_idx" ON "sub_ledger"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE INDEX "sub_ledger_balance_book_idx" ON "sub_ledger_balance"("book");

-- CreateIndex
CREATE UNIQUE INDEX "sub_ledger_balance_book_partner_id_currency_id_key" ON "sub_ledger_balance"("book", "partner_id", "currency_id");

-- AddForeignKey
ALTER TABLE "sub_ledger" ADD CONSTRAINT "sub_ledger_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_ledger" ADD CONSTRAINT "sub_ledger_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_ledger" ADD CONSTRAINT "sub_ledger_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_ledger_balance" ADD CONSTRAINT "sub_ledger_balance_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_ledger_balance" ADD CONSTRAINT "sub_ledger_balance_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

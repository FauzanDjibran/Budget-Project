-- The accounting journal and its lines. Append-only and immutable: nothing
-- in the application updates or deletes either table, and a correction is a
-- new journal. Only the General Ledger derives from these lines — the
-- operational books are written alongside, never from them.

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('Draft', 'Posted');

-- CreateTable
CREATE TABLE "acc_journal" (
    "id" SERIAL NOT NULL,
    "journal_no" TEXT NOT NULL,
    "posting_date" DATE NOT NULL,
    "source_doc_type_id" INTEGER,
    "source_doc_id" INTEGER,
    "company_id" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'Posted',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_journal_line" (
    "id" SERIAL NOT NULL,
    "journal_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "partner_id" INTEGER,
    "currency_id" INTEGER NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "debit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "kredit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "trx_amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_journal_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "acc_journal_journal_no_key" ON "acc_journal"("journal_no");

-- CreateIndex
CREATE INDEX "acc_journal_company_id_posting_date_idx" ON "acc_journal"("company_id", "posting_date");

-- CreateIndex
CREATE INDEX "acc_journal_source_doc_type_id_source_doc_id_idx" ON "acc_journal"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE INDEX "acc_journal_line_journal_id_idx" ON "acc_journal_line"("journal_id");

-- CreateIndex
CREATE INDEX "acc_journal_line_account_id_idx" ON "acc_journal_line"("account_id");

-- AddForeignKey
ALTER TABLE "acc_journal" ADD CONSTRAINT "acc_journal_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_journal" ADD CONSTRAINT "acc_journal_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_journal_line" ADD CONSTRAINT "acc_journal_line_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "acc_journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_journal_line" ADD CONSTRAINT "acc_journal_line_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_journal_line" ADD CONSTRAINT "acc_journal_line_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_journal_line" ADD CONSTRAINT "acc_journal_line_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


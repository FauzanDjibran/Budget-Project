-- CreateEnum
CREATE TYPE "AccountLedger" AS ENUM ('none', 'partner', 'subject_book', 'cash_bank');

-- AlterTable
ALTER TABLE "acc_account" ADD COLUMN     "ledger" "AccountLedger" NOT NULL DEFAULT 'none',
ADD COLUMN     "ledger_book_id" INTEGER;

-- CreateTable
CREATE TABLE "acc_general_journal" (
    "id" SERIAL NOT NULL,
    "journal_no" TEXT NOT NULL,
    "accounting_date" DATE,
    "posted_at" TIMESTAMPTZ(6) DEFAULT transaction_timestamp(),
    "source_doc_type_id" INTEGER,
    "source_doc_id" INTEGER,
    "company_id" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'Draft',
    "is_manual" BOOLEAN NOT NULL DEFAULT true,
    "posted_journal_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_general_journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_general_journal_line" (
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
    "subject_id" INTEGER,
    "cash_bank_layer_id" INTEGER,
    "new_value" DECIMAL(18,2),
    "balance_before" DECIMAL(18,2),
    "is_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_general_journal_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "acc_general_journal_journal_no_key" ON "acc_general_journal"("journal_no");

-- CreateIndex
CREATE UNIQUE INDEX "acc_general_journal_posted_journal_id_key" ON "acc_general_journal"("posted_journal_id");

-- CreateIndex
CREATE INDEX "acc_general_journal_company_id_accounting_date_idx" ON "acc_general_journal"("company_id", "accounting_date");

-- CreateIndex
CREATE INDEX "acc_general_journal_source_doc_type_id_source_doc_id_idx" ON "acc_general_journal"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE INDEX "acc_general_journal_line_journal_id_idx" ON "acc_general_journal_line"("journal_id");

-- CreateIndex
CREATE INDEX "acc_general_journal_line_account_id_idx" ON "acc_general_journal_line"("account_id");

-- CreateIndex
CREATE INDEX "acc_general_journal_line_account_id_subject_id_idx" ON "acc_general_journal_line"("account_id", "subject_id");

-- CreateIndex
CREATE INDEX "acc_general_journal_line_cash_bank_layer_id_idx" ON "acc_general_journal_line"("cash_bank_layer_id");

-- AddForeignKey
ALTER TABLE "acc_account" ADD CONSTRAINT "acc_account_ledger_book_id_fkey" FOREIGN KEY ("ledger_book_id") REFERENCES "sys_budget_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_general_journal" ADD CONSTRAINT "acc_general_journal_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_general_journal" ADD CONSTRAINT "acc_general_journal_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_general_journal" ADD CONSTRAINT "acc_general_journal_posted_journal_id_fkey" FOREIGN KEY ("posted_journal_id") REFERENCES "acc_journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_general_journal_line" ADD CONSTRAINT "acc_general_journal_line_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "acc_general_journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_general_journal_line" ADD CONSTRAINT "acc_general_journal_line_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_general_journal_line" ADD CONSTRAINT "acc_general_journal_line_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_general_journal_line" ADD CONSTRAINT "acc_general_journal_line_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_general_journal_line" ADD CONSTRAINT "acc_general_journal_line_cash_bank_layer_id_fkey" FOREIGN KEY ("cash_bank_layer_id") REFERENCES "cash_bank_layer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (Journal 2.0 D18): every account reads the ledger it already acts
-- as. A book is a Budget Category that names a Partner and says which way it
-- runs; a Cash & Bank account is one a resource posts to. One account, one
-- ledger, so an account that would need two refuses the migration by name.
DO $$
DECLARE clash text;
BEGIN
  SELECT string_agg(a.account_label || ' ' || a.account_name, ', ') INTO clash
  FROM acc_account a
  WHERE (SELECT count(DISTINCT m.budget_category_id)
           FROM acc_budget_category_account m
           JOIN sys_budget_category bc ON bc.id = m.budget_category_id
          WHERE m.account_id = a.id AND bc.require_partner AND bc.raises IS NOT NULL)
        + (CASE WHEN EXISTS (SELECT 1 FROM m_cash_bank cb WHERE cb.account_id = a.id) THEN 1 ELSE 0 END) > 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Account belongs to more than one ledger: %', clash;
  END IF;
END $$;

UPDATE acc_account a SET ledger = 'cash_bank'
WHERE EXISTS (SELECT 1 FROM m_cash_bank cb WHERE cb.account_id = a.id);

UPDATE acc_account a SET ledger = 'subject_book', ledger_book_id = b.budget_category_id
FROM (SELECT DISTINCT m.account_id, m.budget_category_id
        FROM acc_budget_category_account m
        JOIN sys_budget_category bc ON bc.id = m.budget_category_id
       WHERE bc.require_partner AND bc.raises IS NOT NULL) b
WHERE b.account_id = a.id;

UPDATE acc_account SET ledger = 'partner'
WHERE ledger = 'none' AND require_partner;

ALTER TABLE "acc_account" ADD CONSTRAINT "acc_account_ledger_book_check"
  CHECK ((ledger = 'subject_book') = (ledger_book_id IS NOT NULL));

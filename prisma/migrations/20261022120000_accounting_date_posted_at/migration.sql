-- Two dates on every posting row, named the mainstream way (Oracle, Odoo):
-- `accounting_date` is the day the books record, chosen by the user and
-- possibly backdated; `posted_at` is the moment Post ran. `created_at` stays
-- an audit column and is never read as a business date.
--
-- Renamed in place so no row loses its value; only the new `posted_at`
-- columns are filled, once, from what already recorded that moment.

-- The posting documents: their date and their Post timestamp, renamed.
ALTER TABLE "fin_cash_bank_transaction" RENAME COLUMN "document_date" TO "accounting_date";
ALTER TABLE "fin_cash_bank_transaction" RENAME COLUMN "posting_date" TO "posted_at";
ALTER TABLE "fin_cash_bank_transfer" RENAME COLUMN "document_date" TO "accounting_date";
ALTER TABLE "fin_cash_bank_transfer" RENAME COLUMN "posting_date" TO "posted_at";
ALTER TABLE "fin_item_conversion" RENAME COLUMN "document_date" TO "accounting_date";
ALTER TABLE "fin_item_conversion" RENAME COLUMN "posting_date" TO "posted_at";
ALTER TABLE "fin_item_reclass" RENAME COLUMN "document_date" TO "accounting_date";
ALTER TABLE "fin_item_reclass" RENAME COLUMN "posting_date" TO "posted_at";
ALTER TABLE "fin_item_adjustment" RENAME COLUMN "document_date" TO "accounting_date";
ALTER TABLE "fin_item_adjustment" RENAME COLUMN "posting_date" TO "posted_at";
ALTER TABLE "fin_cash_bank_revaluation" RENAME COLUMN "document_date" TO "accounting_date";
ALTER TABLE "fin_cash_bank_revaluation" RENAME COLUMN "posting_date" TO "posted_at";

-- The journal: its date renamed; the Post moment is new. An automatic journal
-- is written by its document's Post, so its created_at is that moment; a
-- manual journal was saved as a draft first, so its moment is the audit row
-- its Post wrote.
ALTER TABLE "acc_journal" RENAME COLUMN "posting_date" TO "accounting_date";
ALTER INDEX "acc_journal_company_id_posting_date_idx" RENAME TO "acc_journal_company_id_accounting_date_idx";
ALTER TABLE "acc_journal" ADD COLUMN "posted_at" TIMESTAMPTZ(6);
UPDATE "acc_journal" j SET "posted_at" = COALESCE(
  (SELECT max(a."at") FROM "audit_log" a
    WHERE a."entity_key" = 'acc_journal' AND a."row_id" = j."id" AND a."event" = 'post'),
  j."created_at")
WHERE j."status" = 'Posted';

-- The Opening Balance: written once, by a close or at go-live.
ALTER TABLE "acc_opening_balance" RENAME COLUMN "posting_date" TO "accounting_date";
ALTER TABLE "acc_opening_balance" ADD COLUMN "posted_at" TIMESTAMPTZ(6);
UPDATE "acc_opening_balance" SET "posted_at" = "created_at";
ALTER TABLE "acc_opening_balance" ALTER COLUMN "posted_at" SET NOT NULL;

-- The books: each row is written inside its document's Post.
ALTER TABLE "cash_bank_ledger" RENAME COLUMN "entry_date" TO "accounting_date";
ALTER INDEX "cash_bank_ledger_cash_bank_id_entry_date_idx" RENAME TO "cash_bank_ledger_cash_bank_id_accounting_date_idx";
ALTER TABLE "cash_bank_ledger" ADD COLUMN "posted_at" TIMESTAMPTZ(6);
UPDATE "cash_bank_ledger" SET "posted_at" = "created_at";
ALTER TABLE "cash_bank_ledger" ALTER COLUMN "posted_at" SET NOT NULL;

ALTER TABLE "sub_ledger" RENAME COLUMN "entry_date" TO "accounting_date";
ALTER INDEX "sub_ledger_budget_category_id_partner_id_entry_date_idx" RENAME TO "sub_ledger_budget_category_id_partner_id_accounting_date_idx";
ALTER TABLE "sub_ledger" ADD COLUMN "posted_at" TIMESTAMPTZ(6);
UPDATE "sub_ledger" SET "posted_at" = "created_at";
ALTER TABLE "sub_ledger" ALTER COLUMN "posted_at" SET NOT NULL;

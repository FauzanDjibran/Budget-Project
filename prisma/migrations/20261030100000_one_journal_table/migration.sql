-- Journal Replacement step 2: one journal table. The old acc_journal /
-- acc_journal_line are dropped and the Jurnal Umum tables, built as a
-- superset of them (Journal 2.0 §6), are renamed into their place. Applied to
-- databases already emptied of transactions (db:truncate-transactions), so no
-- row is carried.

ALTER TABLE "acc_general_journal" DROP CONSTRAINT "acc_general_journal_posted_journal_id_fkey";
DROP INDEX "acc_general_journal_posted_journal_id_key";
ALTER TABLE "acc_general_journal" DROP COLUMN "posted_journal_id";

DROP TABLE "acc_journal_line";
DROP TABLE "acc_journal";

ALTER TABLE "acc_general_journal" RENAME TO "acc_journal";
ALTER TABLE "acc_general_journal_line" RENAME TO "acc_journal_line";
ALTER SEQUENCE "acc_general_journal_id_seq" RENAME TO "acc_journal_id_seq";
ALTER SEQUENCE "acc_general_journal_line_id_seq" RENAME TO "acc_journal_line_id_seq";

ALTER TABLE "acc_journal" RENAME CONSTRAINT "acc_general_journal_pkey" TO "acc_journal_pkey";
ALTER TABLE "acc_journal" RENAME CONSTRAINT "acc_general_journal_company_id_fkey" TO "acc_journal_company_id_fkey";
ALTER TABLE "acc_journal" RENAME CONSTRAINT "acc_general_journal_source_doc_type_id_fkey" TO "acc_journal_source_doc_type_id_fkey";
ALTER INDEX "acc_general_journal_journal_no_key" RENAME TO "acc_journal_journal_no_key";
ALTER INDEX "acc_general_journal_company_id_accounting_date_idx" RENAME TO "acc_journal_company_id_accounting_date_idx";
ALTER INDEX "acc_general_journal_source_doc_type_id_source_doc_id_idx" RENAME TO "acc_journal_source_doc_type_id_source_doc_id_idx";

ALTER TABLE "acc_journal_line" RENAME CONSTRAINT "acc_general_journal_line_pkey" TO "acc_journal_line_pkey";
ALTER TABLE "acc_journal_line" RENAME CONSTRAINT "acc_general_journal_line_journal_id_fkey" TO "acc_journal_line_journal_id_fkey";
ALTER TABLE "acc_journal_line" RENAME CONSTRAINT "acc_general_journal_line_account_id_fkey" TO "acc_journal_line_account_id_fkey";
ALTER TABLE "acc_journal_line" RENAME CONSTRAINT "acc_general_journal_line_partner_id_fkey" TO "acc_journal_line_partner_id_fkey";
ALTER TABLE "acc_journal_line" RENAME CONSTRAINT "acc_general_journal_line_currency_id_fkey" TO "acc_journal_line_currency_id_fkey";
ALTER TABLE "acc_journal_line" RENAME CONSTRAINT "acc_general_journal_line_cash_bank_layer_id_fkey" TO "acc_journal_line_cash_bank_layer_id_fkey";
ALTER INDEX "acc_general_journal_line_journal_id_idx" RENAME TO "acc_journal_line_journal_id_idx";
ALTER INDEX "acc_general_journal_line_account_id_idx" RENAME TO "acc_journal_line_account_id_idx";
ALTER INDEX "acc_general_journal_line_account_id_subject_id_idx" RENAME TO "acc_journal_line_account_id_subject_id_idx";
ALTER INDEX "acc_general_journal_line_cash_bank_layer_id_idx" RENAME TO "acc_journal_line_cash_bank_layer_id_idx";

-- A typed journal names itself as the source of the book entries it writes,
-- through the Journal document type; the Jurnal Umum one is no longer used.
DELETE FROM "sys_doc_type" WHERE "doc_table" = 'acc_general_journal';
UPDATE "audit_log" SET "entity_key" = 'acc_journal' WHERE "entity_key" = 'acc_general_journal';

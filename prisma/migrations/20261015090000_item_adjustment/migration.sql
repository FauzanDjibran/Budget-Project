-- Debit / Credit Note becomes Penyesuaian Open Item, on the user's decision.
-- Renamed in place rather than recreated, so the notes already posted, their
-- subject-book entries, their journals and their history keep pointing at the
-- same rows.

-- An adjustment states its effect on the position. A Debit Note moved the
-- position the way money leaving does, so it raised a book that money
-- leaving raises (a Piutang) and lowered one money arriving raises (a Hutang);
-- a Credit Note the reverse.
CREATE TYPE "ItemAdjustmentEffect" AS ENUM ('Increase', 'Decrease');

ALTER TABLE "fin_dncn" RENAME TO "fin_item_adjustment";
ALTER TABLE "fin_dncn_line" RENAME TO "fin_item_adjustment_line";
ALTER SEQUENCE "fin_dncn_id_seq" RENAME TO "fin_item_adjustment_id_seq";
ALTER SEQUENCE "fin_dncn_line_id_seq" RENAME TO "fin_item_adjustment_line_id_seq";

ALTER TABLE "fin_item_adjustment" RENAME COLUMN "note_no" TO "adjustment_no";
ALTER TABLE "fin_item_adjustment" RENAME COLUMN "note_amount" TO "adjustment_amount";
ALTER TABLE "fin_item_adjustment" RENAME COLUMN "note_base_amount" TO "adjustment_base_amount";
ALTER TABLE "fin_item_adjustment" ADD COLUMN "effect" "ItemAdjustmentEffect";
UPDATE "fin_item_adjustment" a
SET "effect" = CASE
  WHEN (a."note_type" = 'Debit') = (c."raises"::text = 'Out') THEN 'Increase'::"ItemAdjustmentEffect"
  ELSE 'Decrease'::"ItemAdjustmentEffect"
END
FROM "sys_budget_category" c
WHERE c."id" = a."budget_category_id";
ALTER TABLE "fin_item_adjustment" ALTER COLUMN "effect" SET NOT NULL;
ALTER TABLE "fin_item_adjustment" DROP COLUMN "note_type";
DROP TYPE "DncnType";

ALTER TABLE "fin_item_adjustment" RENAME CONSTRAINT "fin_dncn_pkey" TO "fin_item_adjustment_pkey";
ALTER TABLE "fin_item_adjustment" RENAME CONSTRAINT "fin_dncn_company_id_fkey" TO "fin_item_adjustment_company_id_fkey";
ALTER TABLE "fin_item_adjustment" RENAME CONSTRAINT "fin_dncn_budget_category_id_fkey" TO "fin_item_adjustment_budget_category_id_fkey";
ALTER TABLE "fin_item_adjustment" RENAME CONSTRAINT "fin_dncn_partner_id_fkey" TO "fin_item_adjustment_partner_id_fkey";
ALTER TABLE "fin_item_adjustment" RENAME CONSTRAINT "fin_dncn_currency_id_fkey" TO "fin_item_adjustment_currency_id_fkey";
ALTER INDEX "fin_dncn_note_no_key" RENAME TO "fin_item_adjustment_adjustment_no_key";
ALTER INDEX "fin_dncn_company_id_idx" RENAME TO "fin_item_adjustment_company_id_idx";
ALTER INDEX "fin_dncn_partner_id_idx" RENAME TO "fin_item_adjustment_partner_id_idx";
ALTER INDEX "fin_dncn_status_idx" RENAME TO "fin_item_adjustment_status_idx";

ALTER TABLE "fin_item_adjustment_line" RENAME COLUMN "note_id" TO "adjustment_id";
ALTER TABLE "fin_item_adjustment_line" ADD COLUMN "opened_item_id" INTEGER;
ALTER TABLE "fin_item_adjustment_line" RENAME CONSTRAINT "fin_dncn_line_pkey" TO "fin_item_adjustment_line_pkey";
ALTER TABLE "fin_item_adjustment_line" RENAME CONSTRAINT "fin_dncn_line_note_id_fkey" TO "fin_item_adjustment_line_adjustment_id_fkey";
ALTER INDEX "fin_dncn_line_note_id_sequence_no_key" RENAME TO "fin_item_adjustment_line_adjustment_id_sequence_no_key";
CREATE INDEX "fin_item_adjustment_line_opened_item_id_idx" ON "fin_item_adjustment_line"("opened_item_id");

-- The open items a Kurangi line settles, each for the amount the user stated.
CREATE TABLE "fin_item_adjustment_line_item" (
    "id" SERIAL NOT NULL,
    "line_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "sub_ledger_balance_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_item_adjustment_line_item_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fin_item_adjustment_line_item_sub_ledger_balance_id_idx" ON "fin_item_adjustment_line_item"("sub_ledger_balance_id");
CREATE UNIQUE INDEX "fin_item_adjustment_line_item_line_id_sub_ledger_balance_id_key" ON "fin_item_adjustment_line_item"("line_id", "sub_ledger_balance_id");
CREATE UNIQUE INDEX "fin_item_adjustment_line_item_line_id_sequence_no_key" ON "fin_item_adjustment_line_item"("line_id", "sequence_no");
ALTER TABLE "fin_item_adjustment_line_item" ADD CONSTRAINT "fin_item_adjustment_line_item_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "fin_item_adjustment_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The category flag, and the CHECK that keeps it on categories with a book.
ALTER TABLE "sys_budget_category" RENAME COLUMN "allows_dncn" TO "allows_item_adjustment";
ALTER TABLE "sys_budget_category" RENAME CONSTRAINT "sys_budget_category_dncn_needs_book" TO "sys_budget_category_item_adjustment_needs_book";

-- Permissions keep their rows, so every role that held one still does.
UPDATE "sys_permission" SET "permission_code" = 'ITEM_ADJUSTMENT_VIEW', "permission_name" = 'Lihat Penyesuaian Open Item' WHERE "permission_code" = 'DNCN_VIEW';
UPDATE "sys_permission" SET "permission_code" = 'ITEM_ADJUSTMENT_CREATE', "permission_name" = 'Tambah Penyesuaian Open Item' WHERE "permission_code" = 'DNCN_CREATE';
UPDATE "sys_permission" SET "permission_code" = 'ITEM_ADJUSTMENT_EDIT', "permission_name" = 'Ubah Penyesuaian Open Item' WHERE "permission_code" = 'DNCN_EDIT';
UPDATE "sys_permission" SET "permission_code" = 'ITEM_ADJUSTMENT_POST', "permission_name" = 'Post Penyesuaian Open Item' WHERE "permission_code" = 'DNCN_POST';
UPDATE "sys_permission" SET "permission_code" = 'ITEM_ADJUSTMENT_CANCEL', "permission_name" = 'Batalkan Penyesuaian Open Item' WHERE "permission_code" = 'DNCN_CANCEL';

-- The document type keeps its id, which every journal and book entry the
-- notes wrote names as its source.
UPDATE "sys_doc_type"
SET "doc_label" = 'Penyesuaian Open Item', "doc_name" = 'Penyesuaian Open Item', "doc_table" = 'fin_item_adjustment'
WHERE "doc_table" = 'fin_dncn';

UPDATE "audit_log" SET "entity_key" = 'fin_item_adjustment' WHERE "entity_key" = 'fin_dncn';

-- The counter accounts are named by what they are: the one credited is income,
-- the one debited an expense. A Debit Note always credited its account and a
-- Credit Note always debited its own, so the accounts carry straight across.
UPDATE "acc_system_account" SET "account_key" = 'adjustment_income' WHERE "account_key" = 'debit_note';
UPDATE "acc_system_account" SET "account_key" = 'adjustment_expense' WHERE "account_key" = 'credit_note';

-- A subject book is named by its Budget Category's id rather than by the
-- category's code as text. Existing rows keep their book: the code is matched
-- to the category that carries it before the text column is dropped.

-- DropIndex
DROP INDEX "sub_ledger_book_partner_id_entry_date_idx";

-- DropIndex
DROP INDEX "sub_ledger_balance_book_partner_id_currency_id_status_idx";

-- AddColumn, nullable until it is filled
ALTER TABLE "sub_ledger" ADD COLUMN "budget_category_id" INTEGER;
ALTER TABLE "sub_ledger_balance" ADD COLUMN "budget_category_id" INTEGER;

-- Backfill from the code
UPDATE "sub_ledger" AS l SET "budget_category_id" = c."id"
  FROM "sys_budget_category" AS c WHERE c."category_code" = l."book";
UPDATE "sub_ledger_balance" AS b SET "budget_category_id" = c."id"
  FROM "sys_budget_category" AS c WHERE c."category_code" = b."book";

-- Fails loudly if any row named a code no category carries
ALTER TABLE "sub_ledger" ALTER COLUMN "budget_category_id" SET NOT NULL;
ALTER TABLE "sub_ledger_balance" ALTER COLUMN "budget_category_id" SET NOT NULL;

-- DropColumn
ALTER TABLE "sub_ledger" DROP COLUMN "book";
ALTER TABLE "sub_ledger_balance" DROP COLUMN "book";

-- CreateIndex
CREATE INDEX "sub_ledger_budget_category_id_partner_id_entry_date_idx" ON "sub_ledger"("budget_category_id", "partner_id", "entry_date");

-- CreateIndex
CREATE INDEX "sub_ledger_balance_budget_category_id_partner_id_currency_i_idx" ON "sub_ledger_balance"("budget_category_id", "partner_id", "currency_id", "status");

-- AddForeignKey
ALTER TABLE "sub_ledger" ADD CONSTRAINT "sub_ledger_budget_category_id_fkey" FOREIGN KEY ("budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_ledger_balance" ADD CONSTRAINT "sub_ledger_balance_budget_category_id_fkey" FOREIGN KEY ("budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

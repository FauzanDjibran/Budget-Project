-- Journal 2.0 D4 / Journal Replacement step 1: Penyesuaian Open Item and
-- Reklasifikasi Open Item are retired; Jurnal Umum does both jobs. Applied to
-- databases already emptied of transactions (db:truncate-transactions).

DELETE FROM "acc_system_account" WHERE "account_key" IN ('adjustment_income', 'adjustment_expense');
DELETE FROM "audit_log" WHERE "entity_key" IN ('fin_item_adjustment', 'fin_item_reclass');
DELETE FROM "sys_doc_type" WHERE "doc_table" IN ('fin_item_adjustment', 'fin_item_reclass');

-- DropForeignKey
ALTER TABLE "fin_item_adjustment" DROP CONSTRAINT "fin_item_adjustment_budget_category_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_adjustment" DROP CONSTRAINT "fin_item_adjustment_company_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_adjustment" DROP CONSTRAINT "fin_item_adjustment_currency_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_adjustment" DROP CONSTRAINT "fin_item_adjustment_partner_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_adjustment_line" DROP CONSTRAINT "fin_item_adjustment_line_adjustment_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_reclass" DROP CONSTRAINT "fin_item_reclass_budget_category_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_reclass" DROP CONSTRAINT "fin_item_reclass_company_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_reclass" DROP CONSTRAINT "fin_item_reclass_currency_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_reclass" DROP CONSTRAINT "fin_item_reclass_partner_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_reclass_line" DROP CONSTRAINT "fin_item_reclass_line_reclass_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_reclass_line" DROP CONSTRAINT "fin_item_reclass_line_target_budget_category_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_reclass_line" DROP CONSTRAINT "fin_item_reclass_line_target_partner_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_reclass_line_source" DROP CONSTRAINT "fin_item_reclass_line_source_line_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_item_reclass_line_target" DROP CONSTRAINT "fin_item_reclass_line_target_line_id_fkey";

-- AlterTable
ALTER TABLE "sys_budget_category" DROP COLUMN "allows_item_adjustment";

-- DropTable
DROP TABLE "fin_item_adjustment";

-- DropTable
DROP TABLE "fin_item_adjustment_line";

-- DropTable
DROP TABLE "fin_item_reclass";

-- DropTable
DROP TABLE "fin_item_reclass_line";

-- DropTable
DROP TABLE "fin_item_reclass_line_source";

-- DropTable
DROP TABLE "fin_item_reclass_line_target";

-- DropEnum
DROP TYPE "ItemAdjustmentEffect";


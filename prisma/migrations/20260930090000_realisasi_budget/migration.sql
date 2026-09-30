-- DropForeignKey
ALTER TABLE "fin_cash_bank_transaction" DROP CONSTRAINT "fin_cash_bank_transaction_partner_id_fkey";

-- DropForeignKey
ALTER TABLE "sys_purpose" DROP CONSTRAINT "sys_purpose_budget_category_id_fkey";

-- DropForeignKey
ALTER TABLE "sys_purpose" DROP CONSTRAINT "sys_purpose_partner_category_id_fkey";

-- AlterTable
ALTER TABLE "fin_cash_bank_transaction" DROP COLUMN "partner_id",
DROP COLUMN "purpose";

-- DropTable
DROP TABLE "sys_purpose";


-- Teach each Laba Rugi category which step of the multi-step statement it sits
-- in: Pendapatan Usaha, Harga Pokok Penjualan, Beban Usaha, Pendapatan
-- Lain-lain, Beban Lain-lain.
--
-- Stored rather than read off the category's number for the reason `section`
-- is: `5.1` being HPP is a convention of Template COA Sheet1, and a convention
-- that merely holds is one a future maintainer can break with nothing failing.
--
-- Nullable by design and staying so: a Neraca category has no step. The
-- backfill is the same declaration the seed makes, written once here for the
-- six seeded Laba Rugi categories that predate the column, so a deployed
-- database has the column populated without the seed having to run first.

-- CreateEnum
CREATE TYPE "ProfitLossGroup" AS ENUM ('OperatingRevenue', 'CostOfSales', 'OperatingExpense', 'OtherIncome', 'OtherExpense');

-- AlterTable
ALTER TABLE "acc_account_category" ADD COLUMN     "pl_group" "ProfitLossGroup";

UPDATE "acc_account_category" SET "pl_group" = 'OperatingRevenue' WHERE "category_label" = '4.1';
UPDATE "acc_account_category" SET "pl_group" = 'OtherIncome'      WHERE "category_label" = '4.9';
UPDATE "acc_account_category" SET "pl_group" = 'CostOfSales'      WHERE "category_label" = '5.1';
UPDATE "acc_account_category" SET "pl_group" = 'OperatingExpense' WHERE "category_label" IN ('5.2', '5.3');
UPDATE "acc_account_category" SET "pl_group" = 'OtherExpense'     WHERE "category_label" = '5.9';

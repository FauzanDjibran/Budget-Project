/*
  Warnings:

  - Added the required column `base_amount` to the `cash_bank_ledger` table without a default value. This is not possible if the table is not empty.
  - Added the required column `base_balance_after` to the `cash_bank_ledger` table without a default value. This is not possible if the table is not empty.
  - Added the required column `base_movement` to the `cash_bank_ledger` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rate` to the `cash_bank_ledger` table without a default value. This is not possible if the table is not empty.
  - Added the required column `base_amount` to the `sub_ledger` table without a default value. This is not possible if the table is not empty.
  - Added the required column `base_balance_after` to the `sub_ledger` table without a default value. This is not possible if the table is not empty.
  - Added the required column `base_movement` to the `sub_ledger` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rate` to the `sub_ledger` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "cash_bank_balance" ADD COLUMN     "base_balance" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "cash_bank_ledger" ADD COLUMN     "base_amount" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "base_balance_after" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "base_movement" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "rate" DECIMAL(18,6) NOT NULL;

-- AlterTable
ALTER TABLE "sub_ledger" ADD COLUMN     "base_amount" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "base_balance_after" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "base_movement" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "rate" DECIMAL(18,6) NOT NULL;

-- AlterTable
ALTER TABLE "sub_ledger_balance" ADD COLUMN     "base_balance" DECIMAL(18,2) NOT NULL DEFAULT 0;

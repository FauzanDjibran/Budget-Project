/*
  Warnings:

  - You are about to drop the column `amount` on the `cash_bank_ledger` table. All the data in the column will be lost.
  - You are about to drop the column `base_amount` on the `cash_bank_ledger` table. All the data in the column will be lost.
  - You are about to drop the column `direction` on the `cash_bank_ledger` table. All the data in the column will be lost.
  - You are about to drop the column `amount` on the `sub_ledger` table. All the data in the column will be lost.
  - You are about to drop the column `base_amount` on the `sub_ledger` table. All the data in the column will be lost.
  - You are about to drop the column `direction` on the `sub_ledger` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "cash_bank_ledger" DROP COLUMN "amount",
DROP COLUMN "base_amount",
DROP COLUMN "direction";

-- AlterTable
ALTER TABLE "sub_ledger" DROP COLUMN "amount",
DROP COLUMN "base_amount",
DROP COLUMN "direction";

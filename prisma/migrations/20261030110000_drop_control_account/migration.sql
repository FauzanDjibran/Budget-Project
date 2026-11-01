-- Journal Replacement step 5 (R2): the control-account flag goes. The
-- account's ledger decides what a line on it demands, and a typed line on a
-- ledger writes its book in the same transaction, so nothing is left to flag.

-- AlterTable
ALTER TABLE "acc_account" DROP COLUMN "is_control_account";


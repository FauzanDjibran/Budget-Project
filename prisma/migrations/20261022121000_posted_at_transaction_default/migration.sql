-- A row written by a Post takes the transaction's own time, so the journal,
-- the book entries and the snapshot one Post writes all carry one moment.
-- A manual journal draft writes null explicitly; its Post sets the value.

-- AlterTable
ALTER TABLE "acc_journal" ALTER COLUMN "posted_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "acc_opening_balance" ALTER COLUMN "posted_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "cash_bank_ledger" ALTER COLUMN "posted_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "sub_ledger" ALTER COLUMN "posted_at" SET DEFAULT CURRENT_TIMESTAMP;


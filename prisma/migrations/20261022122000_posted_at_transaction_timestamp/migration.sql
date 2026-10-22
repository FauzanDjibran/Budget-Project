-- The default must be filled by Postgres, not by Prisma: Prisma applies a
-- now() default itself, per insert, so one Post's rows came out milliseconds
-- apart. transaction_timestamp() is fixed for the whole transaction, and Prisma
-- reads it back as itself rather than as now().

-- AlterTable
ALTER TABLE "acc_journal" ALTER COLUMN "posted_at" SET DEFAULT transaction_timestamp();

-- AlterTable
ALTER TABLE "acc_opening_balance" ALTER COLUMN "posted_at" SET DEFAULT transaction_timestamp();

-- AlterTable
ALTER TABLE "cash_bank_ledger" ALTER COLUMN "posted_at" SET DEFAULT transaction_timestamp();

-- AlterTable
ALTER TABLE "sub_ledger" ALTER COLUMN "posted_at" SET DEFAULT transaction_timestamp();


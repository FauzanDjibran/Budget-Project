-- AlterEnum
ALTER TYPE "JournalStatus" ADD VALUE 'Cancelled';

-- AlterTable
ALTER TABLE "acc_journal" ADD COLUMN     "is_manual" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "posting_date" DROP NOT NULL;

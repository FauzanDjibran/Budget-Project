-- Subject-book open items: each sub_ledger_balance row becomes one open item,
-- and every sub_ledger entry names the item it moved. Like the realisasi
-- migration before it, this is a reset rather than a carry-over, by the
-- user's instruction: it applies to an empty subject book.

-- CreateEnum
CREATE TYPE "SubLedgerItemStatus" AS ENUM ('Open', 'Cleared');

-- DropIndex
DROP INDEX "sub_ledger_balance_book_idx";

-- DropIndex
DROP INDEX "sub_ledger_balance_book_partner_id_currency_id_key";

-- AlterTable
ALTER TABLE "fin_cash_bank_transaction_line" ADD COLUMN     "sub_ledger_balance_id" INTEGER;

-- AlterTable
ALTER TABLE "sub_ledger" ADD COLUMN     "balance_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "sub_ledger_balance" ADD COLUMN     "base_original" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "item_no" TEXT NOT NULL,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "opened_date" DATE NOT NULL,
ADD COLUMN     "original" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "rate" DECIMAL(18,6) NOT NULL,
ADD COLUMN     "source_doc_id" INTEGER,
ADD COLUMN     "source_doc_type_id" INTEGER,
ADD COLUMN     "status" "SubLedgerItemStatus" NOT NULL DEFAULT 'Open';

-- CreateIndex
CREATE INDEX "sub_ledger_balance_id_idx" ON "sub_ledger"("balance_id");

-- CreateIndex
CREATE UNIQUE INDEX "sub_ledger_balance_item_no_key" ON "sub_ledger_balance"("item_no");

-- CreateIndex
CREATE INDEX "sub_ledger_balance_book_partner_id_currency_id_status_idx" ON "sub_ledger_balance"("book", "partner_id", "currency_id", "status");

-- AddForeignKey
ALTER TABLE "sub_ledger" ADD CONSTRAINT "sub_ledger_balance_id_fkey" FOREIGN KEY ("balance_id") REFERENCES "sub_ledger_balance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "fin_cash_bank_transaction_line" ADD COLUMN     "opened_item_id" INTEGER;

-- CreateIndex
CREATE INDEX "fin_cash_bank_transaction_line_opened_item_id_idx" ON "fin_cash_bank_transaction_line"("opened_item_id");

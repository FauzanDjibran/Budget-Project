-- AlterTable
ALTER TABLE "fin_cash_bank_transaction" ADD COLUMN     "cash_bank_layer_id" INTEGER;

-- AlterTable
ALTER TABLE "fin_cash_bank_transaction_line" ADD COLUMN     "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0;

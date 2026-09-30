-- A Realisasi line may settle several open items, each for an amount the user
-- chose. Applied by a reset (the user's consent): the single-item column is
-- dropped rather than carried over.

-- AlterTable
ALTER TABLE "fin_cash_bank_transaction_line" DROP COLUMN "sub_ledger_balance_id";

-- CreateTable
CREATE TABLE "fin_cash_bank_transaction_line_item" (
    "id" SERIAL NOT NULL,
    "line_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "sub_ledger_balance_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "settlement_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "transaction_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_cash_bank_transaction_line_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_cash_bank_transaction_line_item_sub_ledger_balance_id_idx" ON "fin_cash_bank_transaction_line_item"("sub_ledger_balance_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_bank_transaction_line_item_line_id_sub_ledger_bala_key" ON "fin_cash_bank_transaction_line_item"("line_id", "sub_ledger_balance_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_bank_transaction_line_item_line_id_sequence_no_key" ON "fin_cash_bank_transaction_line_item"("line_id", "sequence_no");

-- AddForeignKey
ALTER TABLE "fin_cash_bank_transaction_line_item" ADD CONSTRAINT "fin_cash_bank_transaction_line_item_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "fin_cash_bank_transaction_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- An allocation settles something.
ALTER TABLE "fin_cash_bank_transaction_line_item" ADD CONSTRAINT "fin_cash_bank_transaction_line_item_amount_positive" CHECK ("amount" > 0);

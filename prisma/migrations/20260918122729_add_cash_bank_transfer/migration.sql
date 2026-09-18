-- CreateEnum
CREATE TYPE "TransferPurpose" AS ENUM ('Transfer', 'Pencairan', 'PembelianValas');

-- CreateTable
CREATE TABLE "fin_cash_bank_transfer" (
    "id" SERIAL NOT NULL,
    "transfer_no" TEXT NOT NULL,
    "document_date" DATE,
    "posting_date" TIMESTAMPTZ(6),
    "company_id" INTEGER NOT NULL,
    "purpose" "TransferPurpose" NOT NULL,
    "from_cash_bank_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "cash_bank_layer_id" INTEGER,
    "transfer_amount" DECIMAL(18,2) NOT NULL,
    "transfer_base_amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'Draft',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_cash_bank_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_cash_bank_transfer_line" (
    "id" SERIAL NOT NULL,
    "transfer_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "to_cash_bank_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL,
    "out_amount" DECIMAL(18,2) NOT NULL,
    "out_base_amount" DECIMAL(18,2) NOT NULL,
    "in_amount" DECIMAL(18,2) NOT NULL,
    "in_base_amount" DECIMAL(18,2) NOT NULL,
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_cash_bank_transfer_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_bank_transfer_transfer_no_key" ON "fin_cash_bank_transfer"("transfer_no");

-- CreateIndex
CREATE INDEX "fin_cash_bank_transfer_company_id_idx" ON "fin_cash_bank_transfer"("company_id");

-- CreateIndex
CREATE INDEX "fin_cash_bank_transfer_status_idx" ON "fin_cash_bank_transfer"("status");

-- CreateIndex
CREATE INDEX "fin_cash_bank_transfer_line_to_cash_bank_id_idx" ON "fin_cash_bank_transfer_line"("to_cash_bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_bank_transfer_line_transfer_id_sequence_no_key" ON "fin_cash_bank_transfer_line"("transfer_id", "sequence_no");

-- AddForeignKey
ALTER TABLE "fin_cash_bank_transfer" ADD CONSTRAINT "fin_cash_bank_transfer_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_transfer" ADD CONSTRAINT "fin_cash_bank_transfer_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_transfer" ADD CONSTRAINT "fin_cash_bank_transfer_from_cash_bank_id_fkey" FOREIGN KEY ("from_cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_transfer_line" ADD CONSTRAINT "fin_cash_bank_transfer_line_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "fin_cash_bank_transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_transfer_line" ADD CONSTRAINT "fin_cash_bank_transfer_line_to_cash_bank_id_fkey" FOREIGN KEY ("to_cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

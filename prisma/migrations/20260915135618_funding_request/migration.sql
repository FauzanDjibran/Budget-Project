-- CreateEnum
CREATE TYPE "FundingStatus" AS ENUM ('Open', 'Closed', 'Cancelled');

-- AlterEnum
ALTER TYPE "TransactionStatus" ADD VALUE 'Pending';

-- CreateTable
CREATE TABLE "fin_funding_request" (
    "id" SERIAL NOT NULL,
    "funding_request_no" TEXT NOT NULL,
    "request_date" DATE NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "request_amount" DECIMAL(18,2) NOT NULL,
    "provider_cash_bank_id" INTEGER,
    "status" "FundingStatus" NOT NULL DEFAULT 'Open',
    "note" TEXT,
    "confirmed_at" TIMESTAMPTZ(6),
    "confirmed_by" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_funding_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_funding_request_funding_request_no_key" ON "fin_funding_request"("funding_request_no");

-- CreateIndex
CREATE INDEX "fin_funding_request_status_idx" ON "fin_funding_request"("status");

-- CreateIndex
CREATE INDEX "fin_funding_request_transaction_id_idx" ON "fin_funding_request"("transaction_id");

-- AddForeignKey
ALTER TABLE "fin_funding_request" ADD CONSTRAINT "fin_funding_request_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_cash_bank_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_funding_request" ADD CONSTRAINT "fin_funding_request_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_funding_request" ADD CONSTRAINT "fin_funding_request_provider_cash_bank_id_fkey" FOREIGN KEY ("provider_cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

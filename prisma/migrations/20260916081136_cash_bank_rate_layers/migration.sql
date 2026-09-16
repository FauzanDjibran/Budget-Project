-- CreateEnum
CREATE TYPE "CashBankLayerStatus" AS ENUM ('Open', 'Exhausted', 'ClosedByRevaluation');

-- CreateTable
CREATE TABLE "cash_bank_layer" (
    "id" SERIAL NOT NULL,
    "layer_no" TEXT NOT NULL,
    "cash_bank_id" INTEGER NOT NULL,
    "acquisition_date" DATE NOT NULL,
    "acquisition_seq" INTEGER NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "foreign_original" DECIMAL(18,2) NOT NULL,
    "base_original" DECIMAL(18,2) NOT NULL,
    "foreign_remaining" DECIMAL(18,2) NOT NULL,
    "base_remaining" DECIMAL(18,2) NOT NULL,
    "status" "CashBankLayerStatus" NOT NULL DEFAULT 'Open',
    "source_doc_type_id" INTEGER,
    "source_doc_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_bank_layer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_bank_layer_layer_no_key" ON "cash_bank_layer"("layer_no");

-- CreateIndex
CREATE INDEX "cash_bank_layer_cash_bank_id_status_acquisition_date_acquis_idx" ON "cash_bank_layer"("cash_bank_id", "status", "acquisition_date", "acquisition_seq");

-- CreateIndex
CREATE INDEX "cash_bank_layer_source_doc_type_id_source_doc_id_idx" ON "cash_bank_layer"("source_doc_type_id", "source_doc_id");

-- AddForeignKey
ALTER TABLE "cash_bank_layer" ADD CONSTRAINT "cash_bank_layer_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bank_layer" ADD CONSTRAINT "cash_bank_layer_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "FiscalClosingStatus" AS ENUM ('Open', 'Closed');

-- CreateTable
CREATE TABLE "acc_fiscal_closing" (
    "id" SERIAL NOT NULL,
    "fiscal_year_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "status" "FiscalClosingStatus" NOT NULL DEFAULT 'Open',
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" INTEGER,
    "closing_journal_id" INTEGER,
    "opening_balance_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_fiscal_closing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "acc_fiscal_closing_company_id_idx" ON "acc_fiscal_closing"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_fiscal_closing_fiscal_year_id_company_id_key" ON "acc_fiscal_closing"("fiscal_year_id", "company_id");

-- AddForeignKey
ALTER TABLE "acc_fiscal_closing" ADD CONSTRAINT "acc_fiscal_closing_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "acc_fiscal_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_fiscal_closing" ADD CONSTRAINT "acc_fiscal_closing_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

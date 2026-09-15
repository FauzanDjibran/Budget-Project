-- CreateEnum
CREATE TYPE "CashBankEntryType" AS ENUM ('Opening', 'Transaction', 'Adjustment');

-- CreateTable
CREATE TABLE "cash_bank_ledger" (
    "id" SERIAL NOT NULL,
    "entry_no" TEXT NOT NULL,
    "cash_bank_id" INTEGER NOT NULL,
    "entry_date" DATE NOT NULL,
    "entry_type" "CashBankEntryType" NOT NULL,
    "direction" "FlowDirection" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "movement" DECIMAL(18,2) NOT NULL,
    "balance_after" DECIMAL(18,2) NOT NULL,
    "source_doc_type_id" INTEGER,
    "source_doc_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_bank_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_bank_balance" (
    "cash_bank_id" INTEGER NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "entry_count" INTEGER NOT NULL DEFAULT 0,
    "last_entry_id" INTEGER,
    "last_entry_date" DATE,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_bank_balance_pkey" PRIMARY KEY ("cash_bank_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_bank_ledger_entry_no_key" ON "cash_bank_ledger"("entry_no");

-- CreateIndex
CREATE INDEX "cash_bank_ledger_cash_bank_id_entry_date_idx" ON "cash_bank_ledger"("cash_bank_id", "entry_date");

-- CreateIndex
CREATE INDEX "cash_bank_ledger_source_doc_type_id_source_doc_id_idx" ON "cash_bank_ledger"("source_doc_type_id", "source_doc_id");

-- AddForeignKey
ALTER TABLE "cash_bank_ledger" ADD CONSTRAINT "cash_bank_ledger_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bank_ledger" ADD CONSTRAINT "cash_bank_ledger_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bank_balance" ADD CONSTRAINT "cash_bank_balance_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Carry any balance already recorded on the master across into the book, as an
-- opening entry, before the column goes away. Without this the figure would
-- simply be lost; the book is the authoritative record from here on.
INSERT INTO "cash_bank_ledger" (
    "entry_no", "cash_bank_id", "entry_date", "entry_type", "direction",
    "amount", "movement", "balance_after", "note", "created_by"
)
SELECT
    'CBL-' || LPAD((ROW_NUMBER() OVER (ORDER BY "id"))::text, 4, '0'),
    "id",
    CURRENT_DATE,
    'Opening',
    CASE WHEN "balance" < 0 THEN 'Out'::"FlowDirection" ELSE 'In'::"FlowDirection" END,
    ABS("balance"),
    "balance",
    "balance",
    'Saldo awal dipindahkan dari master Cash & Bank.',
    "created_by"
FROM "m_cash_bank"
WHERE "balance" <> 0;

INSERT INTO "cash_bank_balance" (
    "cash_bank_id", "balance", "entry_count", "last_entry_id", "last_entry_date"
)
SELECT "cash_bank_id", "balance_after", 1, "id", "entry_date"
FROM "cash_bank_ledger";

-- AlterTable
ALTER TABLE "m_cash_bank" DROP COLUMN "balance";

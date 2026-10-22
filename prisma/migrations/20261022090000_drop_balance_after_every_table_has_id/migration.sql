-- The books store no running balance: an entry may be backdated in among
-- entries written before it, so a balance "after" it followed write order,
-- not date, and nothing read it. And every table carries an `id` primary
-- key; the two that were keyed by their natural key keep it as a unique one.

-- AlterTable
ALTER TABLE "cash_bank_balance" DROP CONSTRAINT "cash_bank_balance_pkey",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "cash_bank_balance_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "cash_bank_ledger" DROP COLUMN "balance_after",
DROP COLUMN "base_balance_after";

-- AlterTable
ALTER TABLE "cash_bank_period" DROP CONSTRAINT "cash_bank_period_pkey",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "cash_bank_period_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "sub_ledger" DROP COLUMN "balance_after",
DROP COLUMN "base_balance_after";

-- CreateIndex
CREATE UNIQUE INDEX "cash_bank_balance_cash_bank_id_key" ON "cash_bank_balance"("cash_bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_bank_period_cash_bank_id_period_key" ON "cash_bank_period"("cash_bank_id", "period");


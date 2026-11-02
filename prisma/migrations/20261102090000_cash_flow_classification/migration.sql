-- Laporan Arus Kas step 1. A Cash Bank Book entry says which source wrote it
-- (one entry type per source, never a direction — the sign is the direction)
-- and carries its own counterparty classification: Partner, Budget Category
-- and the cash-flow group mapped at Post. The groups are rows the user edits,
-- and Mapping Cash Flow says which group a category or an entry type falls in.

-- Every existing entry's new type, decided from what wrote it.
ALTER TABLE "cash_bank_ledger" ADD COLUMN "entry_type_new" TEXT;

UPDATE "cash_bank_ledger" SET "entry_type_new" = CASE "entry_type"::text
  WHEN 'Opening' THEN 'Register'
  WHEN 'Adjustment' THEN 'Journal'
  WHEN 'Revaluation' THEN 'Revaluation'
END
WHERE "entry_type"::text <> 'Transaction';

-- A Realisasi entry: the induk's own document, or the anak's posted by a
-- Funding confirmation on the induk's resource.
UPDATE "cash_bank_ledger" l
SET "entry_type_new" = CASE WHEN c."is_parent" THEN 'Realization' ELSE 'Funding' END
FROM "sys_doc_type" d, "fin_cash_bank_transaction" t, "sys_company" c
WHERE l."entry_type"::text = 'Transaction'
  AND d."id" = l."source_doc_type_id" AND d."doc_table" = 'fin_cash_bank_transaction'
  AND t."id" = l."source_doc_id" AND c."id" = t."company_id";

UPDATE "cash_bank_ledger" l
SET "entry_type_new" = CASE tr."purpose"::text
  WHEN 'Transfer' THEN 'Transfer'
  WHEN 'Pencairan' THEN 'Pencairan'
  WHEN 'PembelianValas' THEN 'BuyFx'
END
FROM "sys_doc_type" d, "fin_cash_bank_transfer" tr
WHERE l."entry_type"::text = 'Transaction'
  AND d."id" = l."source_doc_type_id" AND d."doc_table" = 'fin_cash_bank_transfer'
  AND tr."id" = l."source_doc_id";

UPDATE "cash_bank_ledger" l
SET "entry_type_new" = 'Conversion'
FROM "sys_doc_type" d
WHERE l."entry_type"::text = 'Transaction'
  AND d."id" = l."source_doc_type_id" AND d."doc_table" = 'fin_item_conversion';

DO $$
DECLARE unplaced INTEGER;
BEGIN
  SELECT COUNT(*) INTO unplaced FROM "cash_bank_ledger" WHERE "entry_type_new" IS NULL;
  IF unplaced > 0 THEN
    RAISE EXCEPTION 'cash_bank_ledger: % entries whose source decides no entry type', unplaced;
  END IF;
END $$;

-- AlterEnum
CREATE TYPE "CashBankEntryType_new" AS ENUM ('Realization', 'Funding', 'Transfer', 'Pencairan', 'BuyFx', 'Conversion', 'Journal', 'Register', 'Revaluation');
ALTER TABLE "cash_bank_ledger" ALTER COLUMN "entry_type" TYPE "CashBankEntryType_new" USING ("entry_type_new"::"CashBankEntryType_new");
ALTER TYPE "CashBankEntryType" RENAME TO "CashBankEntryType_old";
ALTER TYPE "CashBankEntryType_new" RENAME TO "CashBankEntryType";
DROP TYPE "CashBankEntryType_old";
ALTER TABLE "cash_bank_ledger" DROP COLUMN "entry_type_new";

-- A revaluation moves base only.
ALTER TABLE "cash_bank_ledger" ADD CONSTRAINT "cash_bank_ledger_revaluation_moves_base_only"
  CHECK ("entry_type" <> 'Revaluation' OR "movement" = 0);

-- AlterTable
ALTER TABLE "cash_bank_ledger" ADD COLUMN     "budget_category_id" INTEGER,
ADD COLUMN     "cashflow_group_id" INTEGER,
ADD COLUMN     "partner_id" INTEGER;

-- CreateTable
CREATE TABLE "sys_cashflow_group" (
    "id" SERIAL NOT NULL,
    "group_code" TEXT NOT NULL,
    "group_label" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_cashflow_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_cashflow_mapping" (
    "id" SERIAL NOT NULL,
    "mapping_code" TEXT NOT NULL,
    "budget_category_id" INTEGER,
    "entry_type" "CashBankEntryType",
    "cashflow_group_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_cashflow_mapping_pkey" PRIMARY KEY ("id"),
    -- A row maps a Budget Category or an entry type, never both, never neither.
    CONSTRAINT "acc_cashflow_mapping_one_key" CHECK (num_nonnulls("budget_category_id", "entry_type") = 1),
    -- Only the types that carry no Budget Category of their own are mapped.
    CONSTRAINT "acc_cashflow_mapping_entry_type_mappable"
      CHECK ("entry_type" IS NULL OR "entry_type" IN ('Funding', 'Pencairan', 'BuyFx', 'Journal'))
);

-- CreateIndex
CREATE UNIQUE INDEX "sys_cashflow_group_group_code_key" ON "sys_cashflow_group"("group_code");

-- CreateIndex
CREATE UNIQUE INDEX "acc_cashflow_mapping_mapping_code_key" ON "acc_cashflow_mapping"("mapping_code");

-- CreateIndex
CREATE UNIQUE INDEX "acc_cashflow_mapping_budget_category_id_key" ON "acc_cashflow_mapping"("budget_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_cashflow_mapping_entry_type_key" ON "acc_cashflow_mapping"("entry_type");

-- CreateIndex
CREATE INDEX "acc_cashflow_mapping_cashflow_group_id_idx" ON "acc_cashflow_mapping"("cashflow_group_id");

-- CreateIndex
CREATE INDEX "cash_bank_ledger_cash_bank_id_accounting_date_cashflow_grou_idx" ON "cash_bank_ledger"("cash_bank_id", "accounting_date", "cashflow_group_id");

-- AddForeignKey
ALTER TABLE "acc_cashflow_mapping" ADD CONSTRAINT "acc_cashflow_mapping_budget_category_id_fkey" FOREIGN KEY ("budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_cashflow_mapping" ADD CONSTRAINT "acc_cashflow_mapping_cashflow_group_id_fkey" FOREIGN KEY ("cashflow_group_id") REFERENCES "sys_cashflow_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bank_ledger" ADD CONSTRAINT "cash_bank_ledger_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bank_ledger" ADD CONSTRAINT "cash_bank_ledger_budget_category_id_fkey" FOREIGN KEY ("budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bank_ledger" ADD CONSTRAINT "cash_bank_ledger_cashflow_group_id_fkey" FOREIGN KEY ("cashflow_group_id") REFERENCES "sys_cashflow_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

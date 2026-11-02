-- A Cash Bank Book entry no longer stores its cash-flow group. The Laporan
-- Arus Kas resolves it through Mapping Cash Flow when it is built — the way an
-- account takes its Laba Rugi step from its category — so changing a mapping,
-- or the groups themselves, restates every period on the report. The entry
-- keeps its Partner and Budget Category, which are facts of the posting.

-- DropForeignKey
ALTER TABLE "cash_bank_ledger" DROP CONSTRAINT "cash_bank_ledger_cashflow_group_id_fkey";

-- DropIndex
DROP INDEX "cash_bank_ledger_cash_bank_id_accounting_date_cashflow_grou_idx";

-- AlterTable
ALTER TABLE "cash_bank_ledger" DROP COLUMN "cashflow_group_id";

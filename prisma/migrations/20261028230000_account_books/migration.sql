-- Journal 2.0 D18, revised 28/10/2026: `partner` and `subject_book` are one
-- ledger, `partner`, and an account keeps a set of books (`acc_account_book`)
-- rather than one, so a Hutang Piutang account can carry both. Saldo baru (D14)
-- is gone from Jurnal Umum, and a line names the book it writes into.

-- CreateTable
CREATE TABLE "acc_account_book" (
    "id" SERIAL NOT NULL,
    "account_book_code" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "budget_category_id" INTEGER NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_account_book_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acc_account_book_account_book_code_key" ON "acc_account_book"("account_book_code");
CREATE INDEX "acc_account_book_budget_category_id_idx" ON "acc_account_book"("budget_category_id");
CREATE UNIQUE INDEX "acc_account_book_account_id_budget_category_id_key" ON "acc_account_book"("account_id", "budget_category_id");

ALTER TABLE "acc_account_book" ADD CONSTRAINT "acc_account_book_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acc_account_book" ADD CONSTRAINT "acc_account_book_budget_category_id_fkey" FOREIGN KEY ("budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Each subject-book account keeps the one book it had.
INSERT INTO "acc_account_book" ("account_book_code", "account_id", "budget_category_id", "created_by")
SELECT 'acbk.' || lpad(row_number() OVER (ORDER BY a.id)::text, 4, '0'), a.id, a.ledger_book_id, a.created_by
FROM "acc_account" a
WHERE a.ledger_book_id IS NOT NULL;

-- AlterTable: a Jurnal Umum line names its book; Saldo baru goes.
ALTER TABLE "acc_general_journal_line" DROP COLUMN "new_value",
ADD COLUMN "budget_category_id" INTEGER;

UPDATE "acc_general_journal_line" l SET "budget_category_id" = a.ledger_book_id
FROM "acc_account" a
WHERE a.id = l.account_id AND a.ledger_book_id IS NOT NULL;

ALTER TABLE "acc_account" DROP CONSTRAINT "acc_account_ledger_book_check";
ALTER TABLE "acc_account" DROP CONSTRAINT "acc_account_ledger_book_id_fkey";
ALTER TABLE "acc_account" DROP COLUMN "ledger_book_id";

-- AlterEnum: subject_book becomes partner.
CREATE TYPE "AccountLedger_new" AS ENUM ('none', 'partner', 'cash_bank');
ALTER TABLE "acc_account" ALTER COLUMN "ledger" DROP DEFAULT;
ALTER TABLE "acc_account" ALTER COLUMN "ledger" TYPE "AccountLedger_new"
  USING (CASE "ledger"::text WHEN 'subject_book' THEN 'partner' ELSE "ledger"::text END::"AccountLedger_new");
ALTER TYPE "AccountLedger" RENAME TO "AccountLedger_old";
ALTER TYPE "AccountLedger_new" RENAME TO "AccountLedger";
DROP TYPE "AccountLedger_old";
ALTER TABLE "acc_account" ALTER COLUMN "ledger" SET DEFAULT 'none';

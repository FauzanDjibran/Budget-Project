-- CreateTable
CREATE TABLE "acc_opening_balance" (
    "id" SERIAL NOT NULL,
    "opening_no" TEXT NOT NULL,
    "posting_date" DATE NOT NULL,
    "fiscal_year_id" INTEGER NOT NULL,
    "source_fiscal_year_id" INTEGER,
    "company_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_opening_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_opening_balance_line" (
    "id" SERIAL NOT NULL,
    "opening_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "partner_id" INTEGER,
    "debit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "kredit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_opening_balance_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "acc_opening_balance_opening_no_key" ON "acc_opening_balance"("opening_no");

-- CreateIndex
CREATE INDEX "acc_opening_balance_company_id_idx" ON "acc_opening_balance"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_opening_balance_fiscal_year_id_company_id_key" ON "acc_opening_balance"("fiscal_year_id", "company_id");

-- CreateIndex
CREATE INDEX "acc_opening_balance_line_opening_id_idx" ON "acc_opening_balance_line"("opening_id");

-- CreateIndex
--
-- NULLS NOT DISTINCT, written by hand because Prisma cannot express it.
--
-- One line per (account, partner?) pair is the whole grain of a snapshot, and
-- an account naming no Partner is the common case — so the duplicate that
-- matters most is two null-partner rows for one account. Postgres treats NULL
-- as distinct from NULL by default, which would let exactly that pair through
-- while refusing every duplicate that names a Partner.
CREATE UNIQUE INDEX "acc_opening_balance_line_opening_id_account_id_partner_id_key" ON "acc_opening_balance_line"("opening_id", "account_id", "partner_id") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "acc_opening_balance" ADD CONSTRAINT "acc_opening_balance_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "acc_fiscal_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_opening_balance" ADD CONSTRAINT "acc_opening_balance_source_fiscal_year_id_fkey" FOREIGN KEY ("source_fiscal_year_id") REFERENCES "acc_fiscal_year"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_opening_balance" ADD CONSTRAINT "acc_opening_balance_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_opening_balance_line" ADD CONSTRAINT "acc_opening_balance_line_opening_id_fkey" FOREIGN KEY ("opening_id") REFERENCES "acc_opening_balance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_opening_balance_line" ADD CONSTRAINT "acc_opening_balance_line_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_opening_balance_line" ADD CONSTRAINT "acc_opening_balance_line_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

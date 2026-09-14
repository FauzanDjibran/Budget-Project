-- CreateEnum
CREATE TYPE "ActiveStatus" AS ENUM ('Active', 'Inactive');

-- CreateEnum
CREATE TYPE "CashBankType" AS ENUM ('Cash', 'Bank');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('Debit', 'Kredit');

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('Draft', 'Open', 'Closed');

-- CreateEnum
CREATE TYPE "FlowDirection" AS ENUM ('In', 'Out');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('Draft', 'Cancelled', 'Submitted', 'Rejected', 'Open', 'Closed');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('TAMBAH', 'UPDATE', 'HAPUS');

-- CreateTable
CREATE TABLE "sys_user" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_company" (
    "id" SERIAL NOT NULL,
    "company_code" TEXT NOT NULL,
    "company_label" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "is_parent" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_account_type" (
    "id" SERIAL NOT NULL,
    "type_code" TEXT NOT NULL,
    "type_label" TEXT NOT NULL,
    "type_name" TEXT NOT NULL,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_account_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_doc_type" (
    "id" SERIAL NOT NULL,
    "doc_code" TEXT NOT NULL,
    "doc_label" TEXT NOT NULL,
    "doc_name" TEXT NOT NULL,
    "doc_table" TEXT NOT NULL,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_doc_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_budget_category" (
    "id" SERIAL NOT NULL,
    "category_code" TEXT NOT NULL,
    "category_label" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_budget_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_partner_category" (
    "id" SERIAL NOT NULL,
    "category_code" TEXT NOT NULL,
    "category_label" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_partner_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ref_currency" (
    "id" SERIAL NOT NULL,
    "currency_code" TEXT NOT NULL,
    "currency_label" TEXT NOT NULL,
    "currency_name" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_partner" (
    "id" SERIAL NOT NULL,
    "partner_code" TEXT NOT NULL,
    "partner_label" TEXT NOT NULL,
    "partner_name" TEXT NOT NULL,
    "company_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_cash_bank" (
    "id" SERIAL NOT NULL,
    "cash_bank_code" TEXT NOT NULL,
    "cash_bank_label" TEXT NOT NULL,
    "cash_bank_name" TEXT NOT NULL,
    "company_id" INTEGER NOT NULL,
    "cash_bank_type" "CashBankType" NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_cash_bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_account_category" (
    "id" SERIAL NOT NULL,
    "account_type_id" INTEGER NOT NULL,
    "category_code" TEXT NOT NULL,
    "category_label" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_account_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_account_subcategory" (
    "id" SERIAL NOT NULL,
    "account_category_id" INTEGER NOT NULL,
    "subcategory_code" TEXT NOT NULL,
    "subcategory_label" TEXT NOT NULL,
    "subcategory_name" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_account_subcategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_account" (
    "id" SERIAL NOT NULL,
    "account_subcategory_id" INTEGER NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_label" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "company_id" INTEGER NOT NULL,
    "parent_account" INTEGER,
    "is_postable" BOOLEAN NOT NULL DEFAULT true,
    "normal_balance" "NormalBalance" NOT NULL,
    "require_partner" BOOLEAN NOT NULL DEFAULT false,
    "partner_category_id" INTEGER,
    "is_control_account" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_budget_category_account" (
    "id" SERIAL NOT NULL,
    "bca_code" TEXT NOT NULL,
    "budget_category_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "partner_category_id" INTEGER,
    "account_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_budget_category_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_fiscal_year" (
    "id" SERIAL NOT NULL,
    "year_code" TEXT NOT NULL,
    "year_label" TEXT NOT NULL,
    "year_name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "note" TEXT,
    "status" "FiscalStatus" NOT NULL DEFAULT 'Draft',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_fiscal_year_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_fiscal_period" (
    "id" SERIAL NOT NULL,
    "fiscal_year_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "period_code" TEXT NOT NULL,
    "period_label" TEXT NOT NULL,
    "period_name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "note" TEXT,
    "status" "FiscalStatus" NOT NULL DEFAULT 'Draft',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_fiscal_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bud_budget" (
    "id" SERIAL NOT NULL,
    "budget_no" TEXT NOT NULL,
    "budget_date" DATE NOT NULL,
    "company_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "budget_type" "FlowDirection" NOT NULL,
    "category_id" INTEGER,
    "partner_id" INTEGER,
    "description" TEXT NOT NULL,
    "budget_amount" DECIMAL(18,2) NOT NULL,
    "realized_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "BudgetStatus" NOT NULL DEFAULT 'Draft',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bud_budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_cash_bank_transaction" (
    "id" SERIAL NOT NULL,
    "transaction_no" TEXT NOT NULL,
    "document_date" DATE,
    "posting_date" TIMESTAMPTZ(6),
    "transaction_type" "FlowDirection" NOT NULL,
    "company_id" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "cash_bank_id" INTEGER,
    "currency_id" INTEGER NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "partner_id" INTEGER,
    "transaction_amount" DECIMAL(18,2) NOT NULL,
    "transaction_base_amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'Draft',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_cash_bank_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_cash_bank_transaction_line" (
    "id" SERIAL NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "outstanding_amount" DECIMAL(18,2) NOT NULL,
    "settlement_amount" DECIMAL(18,2) NOT NULL,
    "settlement_base_amount" DECIMAL(18,2) NOT NULL,
    "settlement_exchange_rate" DECIMAL(18,6),
    "transaction_amount" DECIMAL(18,2) NOT NULL,
    "transaction_base_amount" DECIMAL(18,2) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_cash_bank_transaction_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "entity_key" TEXT NOT NULL,
    "row_id" INTEGER NOT NULL,
    "action" "AuditAction" NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by" INTEGER NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sys_user_email_key" ON "sys_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sys_company_company_code_key" ON "sys_company"("company_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_account_type_type_code_key" ON "sys_account_type"("type_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_account_type_type_label_key" ON "sys_account_type"("type_label");

-- CreateIndex
CREATE UNIQUE INDEX "sys_doc_type_doc_code_key" ON "sys_doc_type"("doc_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_budget_category_category_code_key" ON "sys_budget_category"("category_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_partner_category_category_code_key" ON "sys_partner_category"("category_code");

-- CreateIndex
CREATE UNIQUE INDEX "ref_currency_currency_code_key" ON "ref_currency"("currency_code");

-- CreateIndex
CREATE UNIQUE INDEX "m_partner_partner_code_key" ON "m_partner"("partner_code");

-- CreateIndex
CREATE INDEX "m_partner_company_id_idx" ON "m_partner"("company_id");

-- CreateIndex
CREATE INDEX "m_partner_category_id_idx" ON "m_partner"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "m_cash_bank_cash_bank_code_key" ON "m_cash_bank"("cash_bank_code");

-- CreateIndex
CREATE INDEX "m_cash_bank_company_id_idx" ON "m_cash_bank"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_account_category_category_code_key" ON "acc_account_category"("category_code");

-- CreateIndex
CREATE INDEX "acc_account_category_account_type_id_idx" ON "acc_account_category"("account_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_account_subcategory_subcategory_code_key" ON "acc_account_subcategory"("subcategory_code");

-- CreateIndex
CREATE INDEX "acc_account_subcategory_account_category_id_idx" ON "acc_account_subcategory"("account_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_account_account_code_key" ON "acc_account"("account_code");

-- CreateIndex
CREATE INDEX "acc_account_company_id_idx" ON "acc_account"("company_id");

-- CreateIndex
CREATE INDEX "acc_account_account_subcategory_id_idx" ON "acc_account"("account_subcategory_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_account_company_id_account_label_key" ON "acc_account"("company_id", "account_label");

-- CreateIndex
CREATE UNIQUE INDEX "acc_budget_category_account_bca_code_key" ON "acc_budget_category_account"("bca_code");

-- CreateIndex
CREATE INDEX "acc_budget_category_account_company_id_idx" ON "acc_budget_category_account"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_budget_category_account_company_id_budget_category_id_p_key" ON "acc_budget_category_account"("company_id", "budget_category_id", "partner_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_fiscal_year_year_code_key" ON "acc_fiscal_year"("year_code");

-- CreateIndex
CREATE UNIQUE INDEX "acc_fiscal_period_period_code_key" ON "acc_fiscal_period"("period_code");

-- CreateIndex
CREATE INDEX "acc_fiscal_period_fiscal_year_id_idx" ON "acc_fiscal_period"("fiscal_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "bud_budget_budget_no_key" ON "bud_budget"("budget_no");

-- CreateIndex
CREATE INDEX "bud_budget_company_id_idx" ON "bud_budget"("company_id");

-- CreateIndex
CREATE INDEX "bud_budget_status_idx" ON "bud_budget"("status");

-- CreateIndex
CREATE INDEX "bud_budget_budget_date_idx" ON "bud_budget"("budget_date");

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_bank_transaction_transaction_no_key" ON "fin_cash_bank_transaction"("transaction_no");

-- CreateIndex
CREATE INDEX "fin_cash_bank_transaction_company_id_idx" ON "fin_cash_bank_transaction"("company_id");

-- CreateIndex
CREATE INDEX "fin_cash_bank_transaction_status_idx" ON "fin_cash_bank_transaction"("status");

-- CreateIndex
CREATE INDEX "fin_cash_bank_transaction_line_source_doc_type_id_source_do_idx" ON "fin_cash_bank_transaction_line"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_bank_transaction_line_transaction_id_sequence_no_key" ON "fin_cash_bank_transaction_line"("transaction_id", "sequence_no");

-- CreateIndex
CREATE INDEX "audit_log_entity_key_row_id_idx" ON "audit_log"("entity_key", "row_id");

-- AddForeignKey
ALTER TABLE "m_partner" ADD CONSTRAINT "m_partner_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_partner" ADD CONSTRAINT "m_partner_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "sys_partner_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_cash_bank" ADD CONSTRAINT "m_cash_bank_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_cash_bank" ADD CONSTRAINT "m_cash_bank_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_cash_bank" ADD CONSTRAINT "m_cash_bank_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_account_category" ADD CONSTRAINT "acc_account_category_account_type_id_fkey" FOREIGN KEY ("account_type_id") REFERENCES "sys_account_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_account_subcategory" ADD CONSTRAINT "acc_account_subcategory_account_category_id_fkey" FOREIGN KEY ("account_category_id") REFERENCES "acc_account_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_account" ADD CONSTRAINT "acc_account_account_subcategory_id_fkey" FOREIGN KEY ("account_subcategory_id") REFERENCES "acc_account_subcategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_account" ADD CONSTRAINT "acc_account_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_account" ADD CONSTRAINT "acc_account_partner_category_id_fkey" FOREIGN KEY ("partner_category_id") REFERENCES "sys_partner_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_account" ADD CONSTRAINT "acc_account_parent_account_fkey" FOREIGN KEY ("parent_account") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_budget_category_account" ADD CONSTRAINT "acc_budget_category_account_budget_category_id_fkey" FOREIGN KEY ("budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_budget_category_account" ADD CONSTRAINT "acc_budget_category_account_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_budget_category_account" ADD CONSTRAINT "acc_budget_category_account_partner_category_id_fkey" FOREIGN KEY ("partner_category_id") REFERENCES "sys_partner_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_budget_category_account" ADD CONSTRAINT "acc_budget_category_account_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_fiscal_period" ADD CONSTRAINT "acc_fiscal_period_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "acc_fiscal_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bud_budget" ADD CONSTRAINT "bud_budget_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bud_budget" ADD CONSTRAINT "bud_budget_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bud_budget" ADD CONSTRAINT "bud_budget_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "sys_budget_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bud_budget" ADD CONSTRAINT "bud_budget_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_transaction" ADD CONSTRAINT "fin_cash_bank_transaction_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_transaction" ADD CONSTRAINT "fin_cash_bank_transaction_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_transaction" ADD CONSTRAINT "fin_cash_bank_transaction_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_transaction" ADD CONSTRAINT "fin_cash_bank_transaction_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_transaction_line" ADD CONSTRAINT "fin_cash_bank_transaction_line_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_cash_bank_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_transaction_line" ADD CONSTRAINT "fin_cash_bank_transaction_line_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

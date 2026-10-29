-- Mapping Budget ke Account comes back (user, 29/10/2026), superseding
-- Journal 2.0 D21/D25: the account states only its ledger, and Company ×
-- Budget Category × Partner Category (or none) names one account here. Any
-- number of mappings may name one account, a book and a partner tag included.

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

CREATE UNIQUE INDEX "acc_budget_category_account_bca_code_key" ON "acc_budget_category_account"("bca_code");
CREATE INDEX "acc_budget_category_account_account_id_idx" ON "acc_budget_category_account"("account_id");
-- A category naming no Partner maps once per Company, so two null Partner
-- Categories are the same key.
CREATE UNIQUE INDEX "acc_budget_category_account_company_id_budget_category_id_p_key"
  ON "acc_budget_category_account"("company_id", "budget_category_id", "partner_category_id") NULLS NOT DISTINCT;

ALTER TABLE "acc_budget_category_account" ADD CONSTRAINT "acc_budget_category_account_budget_category_id_fkey" FOREIGN KEY ("budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acc_budget_category_account" ADD CONSTRAINT "acc_budget_category_account_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acc_budget_category_account" ADD CONSTRAINT "acc_budget_category_account_partner_category_id_fkey" FOREIGN KEY ("partner_category_id") REFERENCES "sys_partner_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "acc_budget_category_account" ADD CONSTRAINT "acc_budget_category_account_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every category an account held becomes its mapping, for the account's
-- Partner Category (none where the category names no Partner). D25 already
-- held one account per key, so nothing collides.
INSERT INTO "acc_budget_category_account"
  ("bca_code", "budget_category_id", "company_id", "partner_category_id", "account_id", "created_by")
SELECT 'bcam.' || lpad(row_number() OVER (ORDER BY ab.id)::text, 4, '0'),
       ab.budget_category_id, a.company_id,
       CASE WHEN c.require_partner THEN a.partner_category_id END,
       ab.account_id, ab.created_by
FROM "acc_account_book" ab
JOIN "acc_account" a ON a.id = ab.account_id
JOIN "sys_budget_category" c ON c.id = ab.budget_category_id
WHERE ab.status = 'Active' AND a.ledger = 'category';

-- The account no longer holds categories or a Partner Category.
ALTER TABLE "acc_account" DROP CONSTRAINT "acc_account_partner_category_id_fkey";
ALTER TABLE "acc_account" DROP COLUMN "partner_category_id";
DROP TABLE "acc_account_book";

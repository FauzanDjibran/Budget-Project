-- A chart-of-accounts code names its own place in the tree: `1` is a type,
-- `1.1` a category, `1.1.1` a kelompok, and anything deeper an account. Two
-- rows at the same level may not claim the same code.
--
-- Accounts already carry this through @@unique([company_id, account_label]) —
-- a number is unique per Company, not globally. The skeleton above them is
-- seeded once and shared, so its codes are unique outright.

-- CreateIndex
CREATE UNIQUE INDEX "acc_account_category_category_label_key" ON "acc_account_category"("category_label");

-- CreateIndex
CREATE UNIQUE INDEX "acc_account_subcategory_subcategory_label_key" ON "acc_account_subcategory"("subcategory_label");

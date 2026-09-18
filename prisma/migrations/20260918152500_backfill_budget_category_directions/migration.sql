-- Give the existing Budget Categories their directions before anything checks them.
--
-- `add_budget_partner_category_mapping` added `allows_in`, `allows_out` and
-- `require_partner` to a populated table, so every row already there took the
-- column defaults: no direction at all, and a Partner required. Those defaults
-- are right for a *new* row — the form fills them in — but they leave the rows
-- that predate the column in a state the application would never have allowed,
-- and `budget_category_partner_implies_book` is about to refuse exactly that.
--
-- On a database that has been seeded since, `ensureBudgetCategoryRules` in
-- `prisma/seed.ts` has already corrected them and this does nothing. On one that
-- has not — a deployment migrating straight from before this sequence — this is
-- what stops the CHECK constraints failing to apply. The timestamp places it
-- between the migration that adds the columns and the one that constrains them.
--
-- The values are the same eight the seed declares, and the reasoning is
-- balance-sheet logic rather than cash direction:
--
--   Liability (Titipan, Hutang)   In = obligation up,  Out = obligation down
--   Asset (Piutang, Investasi)    Out = asset up,      In  = asset down
--   Contra-equity (Prive)         Out = drawing up,    In  = drawing down
--   Expense / Fixed asset         Out only, and no Partner
--   Income                        In only
--
-- Matched on `category_label`, and scoped to rows that still carry the "never
-- set" state — both flags false — so a category somebody has since edited is
-- left exactly as they left it.

UPDATE "sys_budget_category" SET
  "allows_in"       = true,
  "allows_out"      = true,
  "require_partner" = true
WHERE "category_label" IN ('Titipan', 'Hutang', 'Piutang', 'Prive')
  AND "allows_in" = false AND "allows_out" = false;

UPDATE "sys_budget_category" SET
  "allows_in"       = false,
  "allows_out"      = true,
  "require_partner" = false
WHERE "category_label" IN ('Asset', 'Biaya')
  AND "allows_in" = false AND "allows_out" = false;

UPDATE "sys_budget_category" SET
  "allows_in"       = false,
  "allows_out"      = true,
  "require_partner" = true
WHERE "category_label" = 'Investasi'
  AND "allows_in" = false AND "allows_out" = false;

UPDATE "sys_budget_category" SET
  "allows_in"       = true,
  "allows_out"      = false,
  "require_partner" = true
WHERE "category_label" = 'Hasil Investasi'
  AND "allows_in" = false AND "allows_out" = false;

-- Anything else the deployment happens to hold. A category with no direction can
-- classify nothing, so rather than failing the migration it is opened in the
-- direction that constrains least — Pengeluaran, which every category in the
-- seeded set allows — and left for its owner to correct through the GUI.
UPDATE "sys_budget_category" SET "allows_out" = true
WHERE "allows_in" = false AND "allows_out" = false;

-- A category that takes no Partner keeps no book, so it must carry no `raises`;
-- one that does keeps a book and must carry one. The book migration set `raises`
-- by label for the six that had books, which is why this only has to close the
-- gaps around them.
UPDATE "sys_budget_category" SET "raises" = NULL
WHERE "require_partner" = false;

UPDATE "sys_budget_category"
SET "raises" = CASE WHEN "allows_out" THEN 'Out'::"FlowDirection" ELSE 'In'::"FlowDirection" END
WHERE "require_partner" = true AND "raises" IS NULL;

-- A category that names a Partner no longer keeps a book by that alone: it is
-- a book when it says so. One that names a Partner without one is a partner
-- tag — its journal lines carry the Partner and no sub_ledger entry is written.
ALTER TABLE "sys_budget_category" ADD COLUMN "keeps_book" BOOLEAN NOT NULL DEFAULT false;

-- Every category that had a direction was a book; it stays one.
UPDATE "sys_budget_category" SET "keeps_book" = true WHERE "require_partner" AND "raises" IS NOT NULL;
UPDATE "sys_budget_category" SET "raises" = NULL WHERE NOT "keeps_book";

ALTER TABLE "sys_budget_category"
  DROP CONSTRAINT "sys_budget_category_partner_implies_book",
  DROP CONSTRAINT "sys_budget_category_item_adjustment_needs_book";

ALTER TABLE "sys_budget_category"
  ADD CONSTRAINT "sys_budget_category_book_needs_partner"
  CHECK ("keeps_book" = false OR "require_partner" = true),
  ADD CONSTRAINT "sys_budget_category_book_has_direction"
  CHECK (("raises" IS NOT NULL) = "keeps_book"),
  ADD CONSTRAINT "sys_budget_category_item_adjustment_needs_book"
  CHECK ("allows_item_adjustment" = false OR "keeps_book" = true);

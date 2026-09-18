-- Naming a Partner means keeping a book, and a book has to know which way it runs.
--
-- The Server Action already refuses this: `raises` is `required` on the registry
-- field and applies exactly when `require_partner` is on. This is the backstop
-- under it, in the same spirit as the unique index under `checkAccountNumber` —
-- the rule is enforced where it can be explained, and made unrepresentable where
-- it can be made unrepresentable.
--
-- It matters more than most, because the state it forbids fails *silently*: a
-- category that names a Partner but has no `raises` keeps no subject book, so a
-- posting against it writes the Cash Bank Book and the Journal and records no
-- subject movement at all. Nothing errors; a Partner's position is simply short.
--
-- The mirror half — that a category naming a Partner must have a Partner
-- Category paired to it before it goes Active — spans two tables and cannot be a
-- CHECK. It lives in `strandedCategories` in `app/actions/master.ts`, asked from
-- all four directions that can reach the state.

-- Any row already in the forbidden state would make the constraint unaddable, so
-- it is closed first. A category that named a Partner without saying which way
-- its book runs was never usable for posting; defaulting it to Pengeluaran where
-- that is the only direction it allows, and Penerimaan otherwise, restores the
-- one answer consistent with what the category already says about itself.
UPDATE "sys_budget_category"
SET "raises" = CASE WHEN "allows_out" THEN 'Out'::"FlowDirection" ELSE 'In'::"FlowDirection" END
WHERE "require_partner" = true AND "raises" IS NULL;

ALTER TABLE "sys_budget_category"
  ADD CONSTRAINT "sys_budget_category_partner_implies_book"
  CHECK ("require_partner" = false OR "raises" IS NOT NULL);

-- And the direction the book runs has to be one the category actually moves in.
-- A book rising on Penerimaan under a Pengeluaran-only category would record
-- every posting as a fall: the position grows negative and the report reads
-- exactly backwards.
UPDATE "sys_budget_category"
SET "raises" = CASE WHEN "allows_out" THEN 'Out'::"FlowDirection" ELSE 'In'::"FlowDirection" END
WHERE ("raises" = 'In' AND "allows_in" = false)
   OR ("raises" = 'Out' AND "allows_out" = false);

ALTER TABLE "sys_budget_category"
  ADD CONSTRAINT "sys_budget_category_raises_is_an_allowed_direction"
  CHECK (
    "raises" IS NULL
    OR ("raises" = 'In' AND "allows_in" = true)
    OR ("raises" = 'Out' AND "allows_out" = true)
  );

-- A category has to be meaningful in at least one direction, or it could
-- classify no Budget at all.
ALTER TABLE "sys_budget_category"
  ADD CONSTRAINT "sys_budget_category_has_a_direction"
  CHECK ("allows_in" = true OR "allows_out" = true);

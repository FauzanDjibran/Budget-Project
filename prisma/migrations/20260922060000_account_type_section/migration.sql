-- Teach the chart of accounts which statement each of its types belongs to.
--
-- The section was going to be read off the first segment of the lineage-composed
-- code — `4` and `5` are Laba Rugi, everything else is Neraca — and that would
-- have worked. It is not stored because it is hard to derive; it is stored
-- because a convention that merely happens to hold is one a future maintainer
-- can break with nothing failing, while a column is a fact the database can be
-- asked for and a test can assert over.
--
-- Added nullable, backfilled by `type_label`, then made NOT NULL, so a deployed
-- database with its five seeded types survives the migration without the seed
-- having to run first. The backfill is the same rule the seed declares, written
-- once here for rows that predate the column.

CREATE TYPE "AccountSection" AS ENUM ('BalanceSheet', 'ProfitLoss');

ALTER TABLE "sys_account_type" ADD COLUMN "section" "AccountSection";

UPDATE "sys_account_type" SET "section" = 'ProfitLoss'
WHERE "type_label" IN ('4', '5');

-- Anything else the deployment happens to hold, including a type somebody added
-- outside the seeded five. Neraca is the safe answer: a balance-sheet account is
-- carried forward rather than closed out, so a type misclassified this way is
-- left standing at closing instead of being zeroed by mistake.
UPDATE "sys_account_type" SET "section" = 'BalanceSheet' WHERE "section" IS NULL;

ALTER TABLE "sys_account_type" ALTER COLUMN "section" SET NOT NULL;

-- Journal 2.0 D25 (29/10/2026): the account is the one place a Budget
-- Category finds its account. The `partner` ledger becomes `category`: an
-- account holds a set of Budget Categories (`acc_account_book`), for its one
-- Partner Category where they take a Partner and for none where they do not.
-- Every account whose ledger is not `none` is a control account. Mapping
-- Budget ke Account (`acc_budget_category_account`) goes: its rows for
-- categories with a Partner already live on the accounts (D18, D21), and its
-- rows for categories without one move onto them here.

-- Refuse rather than guess: a category without a Partner may only move onto
-- an account that holds nothing else.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(a.account_label || ' ' || c.category_label, ', ') INTO bad
  FROM "acc_budget_category_account" m
  JOIN "sys_budget_category" c ON c.id = m.budget_category_id
  JOIN "acc_account" a ON a.id = m.account_id
  WHERE NOT c.require_partner AND (a.ledger <> 'none' OR a.partner_category_id IS NOT NULL);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Mapping tanpa Partner menunjuk account yang sudah memakai ledger atau Partner Category: %', bad;
  END IF;

  SELECT string_agg(a.account_label || ' ' || c.category_label, ', ') INTO bad
  FROM "acc_budget_category_account" m
  JOIN "sys_budget_category" c ON c.id = m.budget_category_id
  JOIN "acc_account" a ON a.id = m.account_id
  WHERE c.require_partner AND NOT EXISTS (
    SELECT 1 FROM "acc_account_book" ab JOIN "acc_account" x ON x.id = ab.account_id
    WHERE x.company_id = m.company_id AND ab.budget_category_id = m.budget_category_id
      AND ab.status = 'Active' AND x.partner_category_id IS NOT DISTINCT FROM m.partner_category_id);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Mapping dengan Partner yang tidak dipegang account mana pun: %', bad;
  END IF;
END $$;

-- AlterEnum
ALTER TYPE "AccountLedger" RENAME VALUE 'partner' TO 'category';

-- Each category without a Partner moves onto the account it was mapped to.
INSERT INTO "acc_account_book" ("account_book_code", "account_id", "budget_category_id", "created_by")
SELECT 'acbk.' || lpad((
    COALESCE((SELECT max(substring(account_book_code FROM 6)::int) FROM "acc_account_book"), 0)
    + row_number() OVER (ORDER BY m.id))::text, 4, '0'),
  m.account_id, m.budget_category_id, m.created_by
FROM "acc_budget_category_account" m
JOIN "sys_budget_category" c ON c.id = m.budget_category_id
WHERE NOT c.require_partner
ON CONFLICT ("account_id", "budget_category_id") DO NOTHING;

UPDATE "acc_account" SET "ledger" = 'category'
WHERE "ledger" = 'none'
  AND "id" IN (SELECT "account_id" FROM "acc_account_book" WHERE "status" = 'Active');

-- Any ledger but `none` is a control account (D25).
UPDATE "acc_account" SET "is_control_account" = true WHERE "ledger" <> 'none';

-- One account per (Company, Budget Category, Partner Category or none).
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(d.category_label, ', ') INTO bad FROM (
    SELECT c.category_label
    FROM "acc_account_book" ab
    JOIN "acc_account" a ON a.id = ab.account_id
    JOIN "sys_budget_category" c ON c.id = ab.budget_category_id
    WHERE ab.status = 'Active'
    GROUP BY a.company_id, c.id, c.category_label, a.partner_category_id
    HAVING count(*) > 1) d;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Kategori dipegang lebih dari satu account: %', bad;
  END IF;
END $$;

-- DropTable
DROP TABLE "acc_budget_category_account";

-- Journal 2.0 step 2: `acc_account.ledger` replaces `require_partner`.
--
-- The backfill of 20261028114823_general_journal runs again first, so an
-- account created or edited since then still reads the ledger it acts as, and
-- an account that would need two ledgers refuses the migration by name.
DO $$
DECLARE clash text;
BEGIN
  SELECT string_agg(a.account_label || ' ' || a.account_name, ', ') INTO clash
  FROM acc_account a
  WHERE (SELECT count(DISTINCT m.budget_category_id)
           FROM acc_budget_category_account m
           JOIN sys_budget_category bc ON bc.id = m.budget_category_id
          WHERE m.account_id = a.id AND bc.require_partner AND bc.raises IS NOT NULL)
        + (CASE WHEN EXISTS (SELECT 1 FROM m_cash_bank cb WHERE cb.account_id = a.id) THEN 1 ELSE 0 END) > 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Account belongs to more than one ledger: %', clash;
  END IF;
END $$;

UPDATE acc_account a SET ledger = 'cash_bank', ledger_book_id = NULL
WHERE EXISTS (SELECT 1 FROM m_cash_bank cb WHERE cb.account_id = a.id);

UPDATE acc_account a SET ledger = 'subject_book', ledger_book_id = b.budget_category_id
FROM (SELECT DISTINCT m.account_id, m.budget_category_id
        FROM acc_budget_category_account m
        JOIN sys_budget_category bc ON bc.id = m.budget_category_id
       WHERE bc.require_partner AND bc.raises IS NOT NULL) b
WHERE b.account_id = a.id;

UPDATE acc_account SET ledger = 'partner'
WHERE ledger = 'none' AND require_partner;

-- AlterTable
ALTER TABLE "acc_account" DROP COLUMN "require_partner";

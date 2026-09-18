-- A subject book becomes a Budget Category, keyed on that category's code.
--
-- Two changes, written by hand because both are data rather than structure.
--
-- 1. The six books that were declared in `subledger-catalogue.ts` hand their
--    per-book facts to the category that owns them. `raises` is the only one
--    nothing else predicts; the icon and the closing label are presentation
--    that no derivation would word as well.
--
-- 2. `sub_ledger.book` stops holding a catalogue slug ("hutang") and starts
--    holding the owning category's code ("bcat.0002"). The column stays TEXT
--    and stays a weak key — deliberately not a foreign key, because a book
--    that imported the table it classifies could not be lifted out, which is
--    the module rule the operational books rest on.
--
-- The mapping joins on `category_label` rather than naming codes directly, so
-- this is correct on any database whose categories were seeded in a different
-- order. A label that has since been renamed simply matches nothing and its
-- rows are left as they are, which is visible rather than silently wrong.

UPDATE "sys_budget_category" SET
  "raises"             = 'In',
  "book_icon"          = 'wallet',
  "book_closing_label" = 'Titipan dipegang'
WHERE "category_label" = 'Titipan';

UPDATE "sys_budget_category" SET
  "raises"             = 'In',
  "book_icon"          = 'coin',
  "book_closing_label" = 'Sisa hutang'
WHERE "category_label" = 'Hutang';

UPDATE "sys_budget_category" SET
  "raises"             = 'Out',
  "book_icon"          = 'clip',
  "book_closing_label" = 'Sisa piutang'
WHERE "category_label" = 'Piutang';

UPDATE "sys_budget_category" SET
  "raises"             = 'Out',
  "book_icon"          = 'user',
  "book_closing_label" = 'Prive berjalan'
WHERE "category_label" = 'Prive';

UPDATE "sys_budget_category" SET
  "raises"             = 'Out',
  "book_icon"          = 'layers',
  "book_closing_label" = 'Investasi tertanam'
WHERE "category_label" = 'Investasi';

UPDATE "sys_budget_category" SET
  "raises"             = 'In',
  "book_icon"          = 'thumb',
  "book_closing_label" = 'Hasil diterima'
WHERE "category_label" = 'Hasil Investasi';

-- Re-key the entries and their materialised positions. Both tables are
-- append-only for business purposes; this is a key migration, not a correction,
-- and it rewrites no amount, date, partner or direction.

UPDATE "sub_ledger" AS e SET "book" = c."category_code"
FROM "sys_budget_category" AS c
WHERE c."category_label" = CASE e."book"
  WHEN 'titipan'         THEN 'Titipan'
  WHEN 'hutang'          THEN 'Hutang'
  WHEN 'piutang'         THEN 'Piutang'
  WHEN 'prive'           THEN 'Prive'
  WHEN 'investasi'       THEN 'Investasi'
  WHEN 'hasil-investasi' THEN 'Hasil Investasi'
END;

UPDATE "sub_ledger_balance" AS b SET "book" = c."category_code"
FROM "sys_budget_category" AS c
WHERE c."category_label" = CASE b."book"
  WHEN 'titipan'         THEN 'Titipan'
  WHEN 'hutang'          THEN 'Hutang'
  WHEN 'piutang'         THEN 'Piutang'
  WHEN 'prive'           THEN 'Prive'
  WHEN 'investasi'       THEN 'Investasi'
  WHEN 'hasil-investasi' THEN 'Hasil Investasi'
END;

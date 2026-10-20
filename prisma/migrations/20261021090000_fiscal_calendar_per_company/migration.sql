-- Each Company keeps its own fiscal calendar, and a period gains its own state:
-- Open, Locked (refuses postings, may be unlocked) and Closed (with its year).
--
-- Every year that existed was shared by both Companies. It becomes the
-- induk's, and an identical year with its twelve periods is created for the
-- anak. What each Company already did to a shared year follows it: its status
-- (a Company that closed the year sees it Closed, the other sees it Open), its
-- closing record, its Opening Balance snapshots, and its `CLS-` journals,
-- whose source names the year they closed.

-- CreateEnum
CREATE TYPE "FiscalPeriodStatus" AS ENUM ('Open', 'Locked', 'Closed');

ALTER TABLE "acc_fiscal_year" ADD COLUMN "company_id" INTEGER;
ALTER TABLE "acc_fiscal_period" ADD COLUMN "company_id" INTEGER;
ALTER TABLE "acc_fiscal_period" ADD COLUMN "period_status" "FiscalPeriodStatus" NOT NULL DEFAULT 'Open';

UPDATE "acc_fiscal_year" SET "company_id" = (SELECT id FROM "sys_company" WHERE is_parent LIMIT 1);

-- One copy per year for the anak, numbered after the highest existing code.
CREATE TEMP TABLE fy_map AS
SELECT y.id AS old_id,
       'fyr.' || lpad((
         (SELECT COALESCE(MAX(NULLIF(regexp_replace(year_code, '\D', '', 'g'), '')::int), 0) FROM "acc_fiscal_year")
         + ROW_NUMBER() OVER (ORDER BY y.id))::text, 4, '0') AS new_code,
       NULL::int AS new_id
FROM "acc_fiscal_year" y
WHERE EXISTS (SELECT 1 FROM "sys_company" WHERE NOT is_parent);

INSERT INTO "acc_fiscal_year" (company_id, year_code, year_label, year_name, start_date, end_date, note,
                               status, created_by, updated_by, created_at, updated_at)
SELECT (SELECT id FROM "sys_company" WHERE NOT is_parent LIMIT 1), m.new_code, y.year_label, y.year_name,
       y.start_date, y.end_date, y.note, y.status, y.created_by, y.updated_by, y.created_at, y.updated_at
FROM fy_map m JOIN "acc_fiscal_year" y ON y.id = m.old_id;

UPDATE fy_map m SET new_id = y.id FROM "acc_fiscal_year" y WHERE y.year_code = m.new_code;

-- A shared year read Closed only once both Companies had closed it. Per
-- Company, Closed is exactly that Company's own close.
UPDATE "acc_fiscal_year" y
SET status = CASE
  WHEN y.status = 'Draft' THEN 'Draft'::"FiscalStatus"
  WHEN EXISTS (SELECT 1 FROM "acc_fiscal_closing" c
               WHERE c.fiscal_year_id = COALESCE((SELECT old_id FROM fy_map WHERE new_id = y.id), y.id)
                 AND c.company_id = y.company_id AND c.status = 'Closed') THEN 'Closed'::"FiscalStatus"
  ELSE 'Open'::"FiscalStatus" END;

UPDATE "acc_fiscal_period" SET company_id = (SELECT company_id FROM "acc_fiscal_year" y WHERE y.id = fiscal_year_id);

INSERT INTO "acc_fiscal_period" (fiscal_year_id, company_id, sequence_no, period_code, period_label, period_name,
                                 start_date, end_date, note, created_by, updated_by, created_at, updated_at)
SELECT m.new_id, (SELECT id FROM "sys_company" WHERE NOT is_parent LIMIT 1), p.sequence_no,
       'fprd.' || lpad((
         (SELECT COALESCE(MAX(NULLIF(regexp_replace(period_code, '\D', '', 'g'), '')::int), 0) FROM "acc_fiscal_period")
         + ROW_NUMBER() OVER (ORDER BY p.id))::text, 4, '0'),
       p.period_label, p.period_name, p.start_date, p.end_date, p.note,
       p.created_by, p.updated_by, p.created_at, p.updated_at
FROM fy_map m JOIN "acc_fiscal_period" p ON p.fiscal_year_id = m.old_id;

-- A period of a closed year is Closed; every other one is Open.
UPDATE "acc_fiscal_period" p SET period_status = 'Closed'
FROM "acc_fiscal_year" y WHERE y.id = p.fiscal_year_id AND y.status = 'Closed';

ALTER TABLE "acc_fiscal_period" DROP COLUMN "status";
ALTER TABLE "acc_fiscal_period" RENAME COLUMN "period_status" TO "status";

-- The anak's records follow it onto its own year.
UPDATE "acc_fiscal_closing" c SET fiscal_year_id = m.new_id
FROM fy_map m, "sys_company" s
WHERE c.fiscal_year_id = m.old_id AND s.id = c.company_id AND NOT s.is_parent;

UPDATE "acc_opening_balance" o SET fiscal_year_id = m.new_id
FROM fy_map m, "sys_company" s
WHERE o.fiscal_year_id = m.old_id AND s.id = o.company_id AND NOT s.is_parent;

UPDATE "acc_opening_balance" o SET source_fiscal_year_id = m.new_id
FROM fy_map m, "sys_company" s
WHERE o.source_fiscal_year_id = m.old_id AND s.id = o.company_id AND NOT s.is_parent;

UPDATE "acc_journal" j SET source_doc_id = m.new_id
FROM fy_map m, "sys_company" s, "sys_doc_type" d
WHERE j.source_doc_id = m.old_id AND j.source_doc_type_id = d.id AND d.doc_table = 'acc_fiscal_year'
  AND s.id = j.company_id AND NOT s.is_parent;

DROP TABLE fy_map;

ALTER TABLE "acc_fiscal_year" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "acc_fiscal_period" ALTER COLUMN "company_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "acc_fiscal_period_company_id_start_date_key" ON "acc_fiscal_period"("company_id", "start_date");
CREATE UNIQUE INDEX "acc_fiscal_year_company_id_year_label_key" ON "acc_fiscal_year"("company_id", "year_label");

-- AddForeignKey
ALTER TABLE "acc_fiscal_year" ADD CONSTRAINT "acc_fiscal_year_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acc_fiscal_period" ADD CONSTRAINT "acc_fiscal_period_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

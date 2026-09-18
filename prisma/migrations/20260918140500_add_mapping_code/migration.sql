-- Add `mapping_code` to the classification mapping.
--
-- Written by hand rather than generated, because the table already holds rows
-- and a required unique column cannot simply be added to them. The backfill
-- uses the row id, which is exactly what `nextCode()` would have produced had
-- the column existed when they were seeded: `bpcm.0001`, `bpcm.0002`, ...

ALTER TABLE "sys_budget_partner_category_mapping" ADD COLUMN "mapping_code" TEXT;

UPDATE "sys_budget_partner_category_mapping"
SET "mapping_code" = 'bpcm.' || LPAD("id"::text, 4, '0')
WHERE "mapping_code" IS NULL;

ALTER TABLE "sys_budget_partner_category_mapping"
  ALTER COLUMN "mapping_code" SET NOT NULL;

CREATE UNIQUE INDEX "sys_budget_partner_category_mapping_mapping_code_key"
  ON "sys_budget_partner_category_mapping"("mapping_code");

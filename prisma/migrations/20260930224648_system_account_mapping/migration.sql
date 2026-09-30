-- CreateTable
CREATE TABLE "acc_system_account" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "account_key" TEXT NOT NULL,
    "account_id" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_system_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "acc_system_account_company_id_account_key_key" ON "acc_system_account"("company_id", "account_key");

-- AddForeignKey
ALTER TABLE "acc_system_account" ADD CONSTRAINT "acc_system_account_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_system_account" ADD CONSTRAINT "acc_system_account_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Move the account-valued settings out of sys_setting. Each old key named one
-- Company in its own text; the new row says it with a foreign key instead.
-- A value that no longer names an account of that Company is dropped rather
-- than carried: it would be refused on the next save anyway.
INSERT INTO "acc_system_account" ("company_id", "account_key", "account_id", "updated_by", "created_at", "updated_at")
SELECT c."id", m."account_key", a."id", s."updated_by", s."created_at", s."updated_at"
FROM "sys_setting" s
JOIN (VALUES
  ('induk_bridge_ar_account',      true,  'bridge_ar'),
  ('induk_bridge_ap_account',      true,  'bridge_ap'),
  ('anak_bridge_ar_account',       false, 'bridge_ar'),
  ('anak_bridge_ap_account',       false, 'bridge_ap'),
  ('induk_fx_account',             true,  'fx'),
  ('anak_fx_account',              false, 'fx'),
  ('induk_accumulated_pl_account', true,  'accumulated_pl'),
  ('anak_accumulated_pl_account',  false, 'accumulated_pl'),
  ('induk_current_pl_account',     true,  'current_pl'),
  ('anak_current_pl_account',      false, 'current_pl'),
  ('induk_debit_note_account',     true,  'debit_note'),
  ('induk_credit_note_account',    true,  'credit_note'),
  ('anak_debit_note_account',      false, 'debit_note'),
  ('anak_credit_note_account',     false, 'credit_note')
) AS m("setting_key", "is_parent", "account_key") ON m."setting_key" = s."setting_key"
JOIN "sys_company" c ON c."is_parent" = m."is_parent"
JOIN "acc_account" a ON a."company_id" = c."id"
  AND s."setting_value" ~ '^[0-9]+$'
  AND a."id" = s."setting_value"::int;

DELETE FROM "sys_setting"
WHERE "setting_key" IN (
  'induk_bridge_ar_account', 'induk_bridge_ap_account',
  'anak_bridge_ar_account', 'anak_bridge_ap_account',
  'induk_fx_account', 'anak_fx_account',
  'induk_accumulated_pl_account', 'anak_accumulated_pl_account',
  'induk_current_pl_account', 'anak_current_pl_account',
  'induk_debit_note_account', 'induk_credit_note_account',
  'anak_debit_note_account', 'anak_credit_note_account',
  -- Retired long ago (the single Belum Ditutup line); nothing reads them.
  'induk_unclosed_pl_account', 'anak_unclosed_pl_account'
);

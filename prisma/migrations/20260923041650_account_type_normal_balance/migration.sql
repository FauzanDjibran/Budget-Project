-- Teach each Account Type which side its own total reads positive on.
--
-- The Neraca signs every row beneath a type by the type's side, not by the
-- account's: Akumulasi Penyusutan is a Kredit account inside AKTIVA, and it
-- has to print as a deduction there. Account-level normal balance cannot say
-- that, and reading the side off the type's number (`1` is AKTIVA) is the
-- inference `section` was stored to avoid.
--
-- Added nullable, backfilled by `type_label`, then made NOT NULL, exactly as
-- `section` was, so a deployed database survives without the seed running
-- first. The backfill is the seed's own declaration, written once here.

ALTER TABLE "sys_account_type" ADD COLUMN "normal_balance" "NormalBalance";

UPDATE "sys_account_type" SET "normal_balance" = 'Debit'  WHERE "type_label" IN ('1', '5');
UPDATE "sys_account_type" SET "normal_balance" = 'Kredit' WHERE "type_label" IN ('2', '3', '4');

-- Anything else a deployment happens to hold. Debit, so an unknown type reads
-- the way the application's accounts default to; the seed corrects any type it
-- declares, and a type it does not declare is not one the seeder knows about.
UPDATE "sys_account_type" SET "normal_balance" = 'Debit' WHERE "normal_balance" IS NULL;

ALTER TABLE "sys_account_type" ALTER COLUMN "normal_balance" SET NOT NULL;

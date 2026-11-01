-- Journal Replacement step 6 (R4): one menu, one permission set. The manual
-- journal's JOURNAL_CREATE / _EDIT / _POST / _CANCEL lose their grants and go
-- first, so no role is silently upgraded; Jurnal Umum's JOURNAL_GENERAL_* take
-- their names, grants intact. JOURNAL_GENERAL_VIEW folds into JOURNAL_VIEW.

DELETE FROM "sys_role_permission"
WHERE "permission_id" IN (
  SELECT "id" FROM "sys_permission"
  WHERE "permission_code" IN ('JOURNAL_CREATE', 'JOURNAL_EDIT', 'JOURNAL_POST', 'JOURNAL_CANCEL')
);
DELETE FROM "sys_permission"
WHERE "permission_code" IN ('JOURNAL_CREATE', 'JOURNAL_EDIT', 'JOURNAL_POST', 'JOURNAL_CANCEL');

UPDATE "sys_permission"
SET "permission_code" = replace("permission_code", 'JOURNAL_GENERAL_', 'JOURNAL_')
WHERE "permission_code" IN (
  'JOURNAL_GENERAL_CREATE', 'JOURNAL_GENERAL_EDIT', 'JOURNAL_GENERAL_POST', 'JOURNAL_GENERAL_CANCEL'
);

INSERT INTO "sys_role_permission" ("role_id", "permission_id", "created_by")
SELECT rp."role_id", v."id", rp."created_by"
FROM "sys_role_permission" rp
JOIN "sys_permission" g ON g."id" = rp."permission_id" AND g."permission_code" = 'JOURNAL_GENERAL_VIEW'
JOIN "sys_permission" v ON v."permission_code" = 'JOURNAL_VIEW'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
DELETE FROM "sys_role_permission"
WHERE "permission_id" IN (SELECT "id" FROM "sys_permission" WHERE "permission_code" = 'JOURNAL_GENERAL_VIEW');
DELETE FROM "sys_permission" WHERE "permission_code" = 'JOURNAL_GENERAL_VIEW';

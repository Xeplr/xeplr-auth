-- 0013_mapping_state.sql
-- DISABLED: shown, greyed out, not usable.
--
-- A role mapping used to say only yes (a row) or no (no row): Enabled or
-- Hidden. `state` on the row is the third answer. A mapped item is
--   enabled    usable (the default: every existing row stays as it was)
--   disabled   shown, but the API refuses it
-- Hidden stays what it was: no row.
--
-- Set from the Access Matrix (POST /auth/api/admin/module-state), for a role.
-- Workspace and user overrides are not stored here.
--
-- Idempotent: columns and constraints added only if absent, rows only if
-- missing.

ALTER TABLE "apisRolesMapping"       ADD COLUMN IF NOT EXISTS "state" varchar(10) NOT NULL DEFAULT 'enabled';
ALTER TABLE "uiPagesRolesMapping"    ADD COLUMN IF NOT EXISTS "state" varchar(10) NOT NULL DEFAULT 'enabled';
ALTER TABLE "uiElementsRolesMapping" ADD COLUMN IF NOT EXISTS "state" varchar(10) NOT NULL DEFAULT 'enabled';
ALTER TABLE "menuRolesMapping"       ADD COLUMN IF NOT EXISTS "state" varchar(10) NOT NULL DEFAULT 'enabled';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['apisRolesMapping', 'uiPagesRolesMapping', 'uiElementsRolesMapping', 'menuRolesMapping'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_state_check') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ("state" IN (''enabled'', ''disabled''))', t, t || '_state_check');
    END IF;
  END LOOP;
END $$;

-- The routes that read and set it, with their catalog rows: reading is
-- access:view, setting is access:edit, like the rest of the Access Matrix.
INSERT INTO "apis" (id, name, "apiGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), v.name, v.grp, false, true, '*', now(), now()
FROM (VALUES ('GET /auth/api/admin/module-states', 'access:view'),
             ('POST /auth/api/admin/module-state', 'access:edit')) AS v(name, grp)
WHERE NOT EXISTS (SELECT 1 FROM "apis" a WHERE a.name = v.name AND a."apiGroup" = v.grp);

INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, a.id, true, '*', now(), now()
FROM "roles" r CROSS JOIN "apis" a
WHERE r.name IN ('Super Admin', 'Admin')
  AND a.name IN ('GET /auth/api/admin/module-states', 'POST /auth/api/admin/module-state')
  AND NOT EXISTS (SELECT 1 FROM "apisRolesMapping" m WHERE m."roleId" = r.id AND m."apiId" = a.id);

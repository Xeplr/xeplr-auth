-- 0010_system_scope.sql
-- SYSTEM SCOPE: what only Super Admin may see, reach or hand out.
--
-- Some things are not a company's business at all: creating and deleting
-- roles, assigning licences, anything that acts on the whole install. They are
-- `scope = 'system'`, and three rules follow from that, enforced in code
-- (lib/systemScope.js and lib/adminRouter.js):
--
--   a system API   is refused to anyone who is not Super Admin, whatever the
--                  role mappings say — it is never granted, so it never
--                  appears in the Access Matrix and the grant routes refuse it
--   a system role  is seen, edited and assigned by Super Admin only
--   everything else is 'company', the default, and works as before
--
-- A product registers its own system APIs the same way, from its own
-- migrations-auth directory: insert the row with "scope" = 'system' (and
-- "scopeLocked" = true to pin it). No code change in this library. Super
-- Admin can also move an API in or out of system scope from Master Settings,
-- except a locked one.
--
-- Idempotent: the columns and constraints are added only if absent, and the
-- rows only if missing.

ALTER TABLE "apis"  ADD COLUMN IF NOT EXISTS "scope" varchar(20) NOT NULL DEFAULT 'company';
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "scope" varchar(20) NOT NULL DEFAULT 'company';

-- A system API a library or app pinned in its migrations. Super Admin can
-- move other APIs in and out of system scope from Master Settings; a locked
-- row cannot be switched off there, so nobody can unguard, say, role
-- deletion by accident.
ALTER TABLE "apis" ADD COLUMN IF NOT EXISTS "scopeLocked" boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apis_scope') THEN
    ALTER TABLE "apis" ADD CONSTRAINT "apis_scope" CHECK ("scope" IN ('system', 'company'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_scope') THEN
    ALTER TABLE "roles" ADD CONSTRAINT "roles_scope" CHECK ("scope" IN ('system', 'company'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "apis_scope_index" ON "apis" ("scope");

-- Roles made before roles belonged to a company were saved with no mtId1,
-- and every company saw them. They stay generic ('*') rather than vanish from
-- every list the moment AUTH_TENANT_HEADER is set.
UPDATE "roles" SET "mtId1" = '*' WHERE "mtId1" IS NULL;

-- The role this whole scope exists for.
UPDATE "roles" SET "scope" = 'system' WHERE "name" = 'Super Admin' AND "scope" <> 'system';

-- The first system APIs: managing roles. Creating, renaming and deleting a
-- role changes what everybody in the install can do.
--
-- A name is either a path (every method) or "METHOD path" (that method only).
--
--   /auth/api/admin/master/roles/delete   already seeded by 0006 as a company
--                                         API; it becomes system here
--   POST /auth/api/admin/master/roles     create and rename. It carries the
--                                         method because GET on the same path
--                                         (0006's listing row) stays open: the
--                                         admin screens need the list.
UPDATE "apis" SET "scope" = 'system', "scopeLocked" = true
WHERE name = '/auth/api/admin/master/roles/delete' AND ("scope" <> 'system' OR NOT "scopeLocked");

INSERT INTO "apis" (id, name, "apiGroup", "scope", "scopeLocked", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), v.name, v.grp, 'system', true, false, true, '*', now(), now()
FROM (VALUES
  ('POST /auth/api/admin/master/roles', 'roles:edit'),
  -- Copying roles from one company into others: only Super Admin works
  -- across companies.
  ('/auth/api/admin/master/roles/copy', 'roles:edit'),
  -- Moving an API in or out of system scope (Master Settings' "Super Admin
  -- only" switch). Locked, or it could switch itself off.
  ('/auth/api/admin/master/apis/scope', 'apis:edit')
) AS v(name, grp)
WHERE NOT EXISTS (SELECT 1 FROM "apis" a WHERE a.name = v.name);

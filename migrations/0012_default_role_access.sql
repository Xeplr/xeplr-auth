-- 0012_default_role_access.sql
-- Auth's own routes, mapped to auth's default roles. Every route is now
-- checked against these mappings (accessGate), not only for a signed-in token.
--
-- Three kinds of URL:
--   system   Super Admin only (apis.scope = 'system'); never mapped to a
--            company role, and systemScopeGuard refuses it to anyone else
--   admin    users:*, access:*, settings:*  → Admin
--   user     account:* (my profile, my password)  → every role
--
-- These are defaults for a fresh install; change them from the Access Matrix.
-- An app with its own roles maps them in its own migrations-auth/.

INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, a.id, true, '*', now(), now()
FROM "roles" r CROSS JOIN "apis" a
WHERE r.name = 'Admin'
  AND a.scope IS DISTINCT FROM 'system'
  AND (a."apiGroup" LIKE 'account:%' OR a."apiGroup" LIKE 'users:%'
       OR a."apiGroup" LIKE 'access:%' OR a."apiGroup" LIKE 'settings:%')
  AND NOT EXISTS (SELECT 1 FROM "apisRolesMapping" m WHERE m."roleId" = r.id AND m."apiId" = a.id);

INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, a.id, true, '*', now(), now()
FROM "roles" r CROSS JOIN "apis" a
WHERE r.name IN ('Editor', 'Viewer')
  AND a.scope IS DISTINCT FROM 'system'
  AND a."apiGroup" LIKE 'account:%'
  AND NOT EXISTS (SELECT 1 FROM "apisRolesMapping" m WHERE m."roleId" = r.id AND m."apiId" = a.id);

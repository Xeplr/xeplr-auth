-- 0014_activation_routes.sql
-- Routes added for the sign-up flow, plus three that shipped without a row.
--
--   POST /auth/api/resend-activation            public: a new activation link
--   POST /auth/api/admin/users/:id/activate     users:edit: activate by hand
--   /auth/api/invite-preview, invite-accept     public: the accept-invite page
--   /auth/api/sse-ticket                        account:view: any signed-in role
--
-- invite-preview, invite-accept and sse-ticket existed with no row, and an
-- unregistered API is open to everyone — sse-ticket is meant for signed-in
-- users only.
--
-- Mapped the same way as 0012: users:* to Super Admin and Admin, account:* to
-- every base role. An app's own roles (CompanyAdmin, Creator) are mapped in
-- the app's migrations-auth/.

INSERT INTO "apis" (id, name, "apiGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), v.name, v.grp, v.pub, true, '*', now(), now()
FROM (VALUES
  ('POST /auth/api/resend-activation', '', true),
  ('POST /auth/api/admin/users/:id/activate', 'users:edit', false),
  ('GET /auth/api/invite-preview', '', true),
  ('POST /auth/api/invite-accept', '', true),
  ('POST /auth/api/sse-ticket', 'account:view', false)
) AS v(name, grp, pub)
WHERE NOT EXISTS (SELECT 1 FROM "apis" a WHERE a.name = v.name AND a."apiGroup" = v.grp);

INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, a.id, true, '*', now(), now()
FROM "roles" r CROSS JOIN "apis" a
WHERE r.name IN ('Super Admin', 'Admin')
  AND a.name = 'POST /auth/api/admin/users/:id/activate' AND a."apiGroup" = 'users:edit'
  AND NOT EXISTS (SELECT 1 FROM "apisRolesMapping" m WHERE m."roleId" = r.id AND m."apiId" = a.id);

INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, a.id, true, '*', now(), now()
FROM "roles" r CROSS JOIN "apis" a
WHERE r.name IN ('Super Admin', 'Admin', 'Editor', 'Viewer')
  AND a.name = 'POST /auth/api/sse-ticket' AND a."apiGroup" = 'account:view'
  AND NOT EXISTS (SELECT 1 FROM "apisRolesMapping" m WHERE m."roleId" = r.id AND m."apiId" = a.id);

-- The two public pages that go with them (the UI's /auth/resend-activation
-- and /auth/accept-invite), next to Login, Register and the rest from 0006.
INSERT INTO "uiPages" (id, name, "uiPagesGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), v.name, '', true, true, '*', now(), now()
FROM (VALUES ('Resend Activation'), ('Accept Invite')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM "uiPages" p WHERE p.name = v.name AND p."uiPagesGroup" = '');

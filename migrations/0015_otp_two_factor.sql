-- 0015_otp_two_factor.sql
-- Signing in with a code (email or mobile) and the second step (2FA).
--
-- users:
--   twoFactorMethod     what this person's second step uses: 'authenticator',
--                       'email' or 'sms'; NULL = not turned on (AUTH_2FA=optional)
--   totpSecret          the authenticator app's secret, encrypted with
--                       ENCRYPTION_KEY (never stored in clear)
--   twoFactorChangedOn  when the above last changed. A trusted device
--                       remembers this value; a change (or an admin reset)
--                       makes every earlier "trust this device" ask again.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "twoFactorMethod" varchar(20);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totpSecret" varchar(500);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "twoFactorChangedOn" timestamp;

-- ONE PERSON PER VERIFIED NUMBER: signing in by mobile finds the account by
-- its number, so two accounts holding the same verified number would make it
-- a guess. The code refuses a second one at verification; this index holds it
-- in the database too. An install that already has duplicates is not stopped
-- from starting — it is told, and the code's check still applies.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "users"
    WHERE "phoneVerified" = true AND "phoneNumber" IS NOT NULL
    GROUP BY regexp_replace("phoneNumber", '[^0-9+]', '', 'g')
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'users: some verified phone numbers belong to more than one account; unique index not created. Unverify the duplicates, then create users_verified_phone_unique.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "users_verified_phone_unique"
      ON "users" (regexp_replace("phoneNumber", '[^0-9+]', '', 'g'))
      WHERE "phoneVerified" = true AND "phoneNumber" IS NOT NULL;
  END IF;
END $$;

-- ROUTES.
--
--   public (how a caller gets a token, so no group):
--     GET  /auth/api/sign-in-options             which ways in this server offers
--     POST /auth/api/login/code                  send a sign-in code (email or mobile)
--     POST /auth/api/login/code/verify           sign in with it
--     POST /auth/api/login/second-step/send      send the second-step code (email/SMS)
--     POST /auth/api/login/second-step/verify    finish signing in
--   account:* (my own second step):
--     GET  /auth/api/two-factor                  account:view
--     POST /auth/api/two-factor/authenticator    account:edit  start setting up the app
--     POST /auth/api/two-factor/authenticator/confirm  account:edit
--     POST /auth/api/two-factor/method           account:edit  choose / turn off
--   users:edit:
--     POST /auth/api/admin/users/:id/two-factor/reset

INSERT INTO "apis" (id, name, "apiGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), v.name, v.grp, v.pub, true, '*', now(), now()
FROM (VALUES
  ('GET /auth/api/sign-in-options', '', true),
  ('POST /auth/api/login/code', '', true),
  ('POST /auth/api/login/code/verify', '', true),
  ('POST /auth/api/login/second-step/send', '', true),
  ('POST /auth/api/login/second-step/verify', '', true),
  ('GET /auth/api/two-factor', 'account:view', false),
  ('POST /auth/api/two-factor/authenticator', 'account:edit', false),
  ('POST /auth/api/two-factor/authenticator/confirm', 'account:edit', false),
  ('POST /auth/api/two-factor/method', 'account:edit', false),
  ('POST /auth/api/admin/users/:id/two-factor/reset', 'users:edit', false)
) AS v(name, grp, pub)
WHERE NOT EXISTS (SELECT 1 FROM "apis" a WHERE a.name = v.name AND a."apiGroup" = v.grp);

-- WHO GETS THEM: every role that can already reach the route beside it — any
-- role that opens its own profile gets its own second step; any role that can
-- activate a user by hand can reset one's second step. That covers auth's
-- default roles AND each app's own (BI's CompanyAdmin, Creator, Viewer;
-- Taskie's), whose account:* mappings their own migrations made long before
-- these routes existed and will not run again.

INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT DISTINCT ON (m."roleId", a.id) encode(gen_random_bytes(12), 'hex'), m."roleId", a.id, true, '*', now(), now()
FROM "apisRolesMapping" m
JOIN "apis" have ON have.id = m."apiId" AND have.name = '/auth/api/profile' AND have."apiGroup" = 'account:view'
CROSS JOIN "apis" a
WHERE m."isActive" = true
  AND a.name IN ('GET /auth/api/two-factor', 'POST /auth/api/two-factor/authenticator',
                 'POST /auth/api/two-factor/authenticator/confirm', 'POST /auth/api/two-factor/method')
  AND a."apiGroup" IN ('account:view', 'account:edit')
  AND NOT EXISTS (SELECT 1 FROM "apisRolesMapping" x WHERE x."roleId" = m."roleId" AND x."apiId" = a.id);

INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT DISTINCT ON (m."roleId", a.id) encode(gen_random_bytes(12), 'hex'), m."roleId", a.id, true, '*', now(), now()
FROM "apisRolesMapping" m
JOIN "apis" have ON have.id = m."apiId" AND have.name = 'POST /auth/api/admin/users/:id/activate' AND have."apiGroup" = 'users:edit'
CROSS JOIN "apis" a
WHERE m."isActive" = true
  AND a.name = 'POST /auth/api/admin/users/:id/two-factor/reset' AND a."apiGroup" = 'users:edit'
  AND NOT EXISTS (SELECT 1 FROM "apisRolesMapping" x WHERE x."roleId" = m."roleId" AND x."apiId" = a.id);

-- Super Admin and Admin by name as well, in case a fresh install's mapping of
-- the neighbour route is still to come.
INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, a.id, true, '*', now(), now()
FROM "roles" r CROSS JOIN "apis" a
WHERE r.name IN ('Super Admin', 'Admin')
  AND a.name IN ('GET /auth/api/two-factor', 'POST /auth/api/two-factor/authenticator',
                 'POST /auth/api/two-factor/authenticator/confirm', 'POST /auth/api/two-factor/method',
                 'POST /auth/api/admin/users/:id/two-factor/reset')
  AND a."apiGroup" <> ''
  AND NOT EXISTS (SELECT 1 FROM "apisRolesMapping" m WHERE m."roleId" = r.id AND m."apiId" = a.id);

INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, a.id, true, '*', now(), now()
FROM "roles" r CROSS JOIN "apis" a
WHERE r.name IN ('Editor', 'Viewer')
  AND a.name IN ('GET /auth/api/two-factor', 'POST /auth/api/two-factor/authenticator',
                 'POST /auth/api/two-factor/authenticator/confirm', 'POST /auth/api/two-factor/method')
  AND NOT EXISTS (SELECT 1 FROM "apisRolesMapping" m WHERE m."roleId" = r.id AND m."apiId" = a.id);

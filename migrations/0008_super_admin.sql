-- 0008_super_admin.sql
-- THE FIRST ACCOUNT. Every install needs one, so this package ships it rather
-- than leaving each app to hand-write the same SQL.
--
-- It used to be the app's job: 0006 creates the "Super Admin" ROLE but nothing
-- created a super admin USER, so every consumer copied a version of this file
-- into its own migrations-auth/. That copy restated things this package owns —
-- the users columns, that normalizedEmail is the lowercased one, that the role
-- is spelled exactly 'Super Admin', that passwords are bcrypt — so a change
-- here silently broke every copy out there. And it broke as "invalid email or
-- password", which sends somebody hunting their password rather than their
-- migration.
--
-- WHO is still the app's decision; only HOW lives here. Both values come from
-- the environment and are substituted at apply time, so the password is never
-- written into a file. The migrator REFUSES to run when either is unset,
-- naming the variable — deliberately, because the alternative is an install
-- that migrates cleanly and has no way to sign in.
--
-- No quotes, spaces, $ or # in the password: these are substituted into SQL
-- text, the same constraint every other env-substituted migration here has.
--
-- Insert-if-absent on both statements, so re-running changes nothing — and an
-- app that already seeded its own super admin under the same address keeps the
-- one it has, password included.

INSERT INTO "users" (
  id, email, "normalizedEmail", name, pwd, "isActive", "isActivated",
  "activatedOn", "activatedBy", "mtId1", "recordCreatedDate", "recordModifiedDate"
)
SELECT
  encode(gen_random_bytes(12), 'hex'),
  '${AUTH_SUPER_ADMIN_EMAIL}',
  lower('${AUTH_SUPER_ADMIN_EMAIL}'),
  'Super Admin',
  crypt('${AUTH_SUPER_ADMIN_PASSWORD}', gen_salt('bf')),
  true,
  true,
  now(),
  'system',
  -- '*' — belongs to every tenant rather than to one company, so the first
  -- account can still sign in before any company exists.
  '*',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "users" WHERE "normalizedEmail" = lower('${AUTH_SUPER_ADMIN_EMAIL}')
);

INSERT INTO "userRolesMapping" (id, "userId", "roleId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), u.id, r.id, true, '*', now(), now()
FROM "users" u
CROSS JOIN "roles" r
WHERE u."normalizedEmail" = lower('${AUTH_SUPER_ADMIN_EMAIL}')
  AND r.name = 'Super Admin'
  AND NOT EXISTS (
    SELECT 1 FROM "userRolesMapping" m WHERE m."userId" = u.id AND m."roleId" = r.id
  );

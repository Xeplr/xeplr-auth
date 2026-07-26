-- 0006_seed_catalog.sql
-- Base roles + the full apis/uiPages/uiElements/menus catalog for every route
-- xeplr-auth ships (authRouter.js + adminRouter.js), plus the "god-mode"
-- mapping of Super Admin/Admin to everything that exists at this point.
--
-- ids use pgcrypto's gen_random_bytes (enabled in 0001) to match the app's
-- own generateId() shape: a 24-char lowercase hex string.
--
-- isPublic:true rows need no role mapping — accessService.getUserAccess()
-- unions every isPublic:true row into every authenticated user's access,
-- regardless of role (see @xeplr/auth/lib/accessService.js getPublicItems()).

INSERT INTO "roles" (id, name, "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate") VALUES
  (encode(gen_random_bytes(12), 'hex'), 'Super Admin', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Admin', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Editor', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Viewer', true, '*', now(), now());

INSERT INTO "apis" (id, name, "apiGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate") VALUES
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/register', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/activate', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/login', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/forgot-password', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/reset-password', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/refresh', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/logout', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/me', 'account:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/profile', 'account:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/profile/avatar', 'account:edit', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/change-password', 'account:edit', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/request-phone-otp', 'account:edit', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/verify-phone-otp', 'account:edit', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/users', 'users:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/roles', 'users:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/user-role', 'users:edit', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/access-items', 'access:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/access-role', 'access:edit', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/module-role', 'access:edit', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/roles', 'settings:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/roles/save', 'settings:edit', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/roles/delete', 'settings:delete', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/apis', 'settings:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/apis/save', 'settings:edit', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/apis/delete', 'settings:delete', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/pages', 'settings:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/pages/save', 'settings:edit', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/pages/delete', 'settings:delete', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/elements', 'settings:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/elements/save', 'settings:edit', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/elements/delete', 'settings:delete', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/menus', 'settings:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/menus/save', 'settings:edit', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), '/auth/api/admin/master/menus/delete', 'settings:delete', false, true, '*', now(), now());

INSERT INTO "uiPages" (id, name, "uiPagesGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate") VALUES
  (encode(gen_random_bytes(12), 'hex'), 'Login', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Register', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Forgot Password', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Reset Password', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Activate Account', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Not Activated', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Profile', 'account:view', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Change Password', 'account:edit', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'User Roles', 'users:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Access Matrix', 'access:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Master Settings', 'settings:view', false, true, '*', now(), now());

INSERT INTO "uiElements" (id, name, "uiElementsGroup", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate") VALUES
  (encode(gen_random_bytes(12), 'hex'), 'Assign Role Button', 'users:edit', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Remove Role Button', 'users:edit', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Toggle Access Checkbox', 'access:edit', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Toggle Module Access Checkbox', 'access:edit', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Add Role Button', 'settings:edit', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Delete Role Button', 'settings:delete', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Add API Button', 'settings:edit', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Delete API Button', 'settings:delete', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Add Page Button', 'settings:edit', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Delete Page Button', 'settings:delete', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Add Element Button', 'settings:edit', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Delete Element Button', 'settings:delete', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Add Menu Button', 'settings:edit', true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Delete Menu Button', 'settings:delete', true, '*', now(), now());

INSERT INTO "menus" (id, name, "menuGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate") VALUES
  (encode(gen_random_bytes(12), 'hex'), 'Login', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Register', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Forgot Password', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Reset Password', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Activate Account', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Not Activated', '', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Notifications', 'account:view', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Profile', 'account:view', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Change Password', 'account:edit', true, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'User Roles', 'users:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Access Matrix', 'access:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Master Settings', 'settings:view', false, true, '*', now(), now()),
  (encode(gen_random_bytes(12), 'hex'), 'Admin', 'admin:view', false, true, '*', now(), now());

-- God-mode: Super Admin + Admin see everything that exists at this point,
-- public or not (isPublic:true rows would reach them anyway — this also
-- covers the non-public ones without hand-picking which).
INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, a.id, true, '*', now(), now()
FROM "roles" r CROSS JOIN "apis" a
WHERE r.name IN ('Super Admin', 'Admin');

INSERT INTO "uiPagesRolesMapping" (id, "roleId", "uiPageId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, p.id, true, '*', now(), now()
FROM "roles" r CROSS JOIN "uiPages" p
WHERE r.name IN ('Super Admin', 'Admin');

INSERT INTO "uiElementsRolesMapping" (id, "roleId", "uiElementId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, e.id, true, '*', now(), now()
FROM "roles" r CROSS JOIN "uiElements" e
WHERE r.name IN ('Super Admin', 'Admin');

INSERT INTO "menuRolesMapping" (id, "menuId", "roleId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), m.id, r.id, true, '*', now(), now()
FROM "roles" r CROSS JOIN "menus" m
WHERE r.name IN ('Super Admin', 'Admin');

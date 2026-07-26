// Base access data — folded into a MIGRATION (not a seed) so it runs exactly
// once via the ledger. Roles, apis, pages, elements, menus,
// and the god-mode role→everything mapping. Inserts are insert-if-absent, so
// re-running on an already-seeded DB (e.g. migrating an old app) is a no-op.

var crypto = require('crypto');
function generateId() { return crypto.randomBytes(12).toString('hex').substring(0, 25); }
var MT_ALL = '*';

var ROLES = ['Super Admin', 'Admin', 'Editor', 'Viewer'];

var APIS = [
  { name: '/auth/api/register', apiGroup: '', isPublic: true },
  { name: '/auth/api/activate', apiGroup: '', isPublic: true },
  { name: '/auth/api/login', apiGroup: '', isPublic: true },
  { name: '/auth/api/forgot-password', apiGroup: '', isPublic: true },
  { name: '/auth/api/reset-password', apiGroup: '', isPublic: true },
  { name: '/auth/api/refresh', apiGroup: '', isPublic: true },
  { name: '/auth/api/logout', apiGroup: '', isPublic: true },
  { name: '/auth/api/me', apiGroup: 'account:view', isPublic: false },
  { name: '/auth/api/admin/users', apiGroup: 'users:view', isPublic: false },
  { name: '/auth/api/admin/roles', apiGroup: 'users:view', isPublic: false },
  { name: '/auth/api/admin/user-role', apiGroup: 'users:edit', isPublic: false },
  { name: '/auth/api/admin/access-items', apiGroup: 'access:view', isPublic: false },
  { name: '/auth/api/admin/access-role', apiGroup: 'access:edit', isPublic: false },
  { name: '/auth/api/admin/module-role', apiGroup: 'access:edit', isPublic: false },
  { name: '/auth/api/admin/tenants', apiGroup: 'tenants:view', isPublic: false },
  { name: '/auth/api/admin/tenants/save', apiGroup: 'tenants:edit', isPublic: false },
  { name: '/auth/api/admin/tenants/delete', apiGroup: 'tenants:delete', isPublic: false },
  { name: '/auth/api/admin/tenants/assign-user', apiGroup: 'tenants:edit', isPublic: false },
  { name: '/auth/api/admin/master/roles', apiGroup: 'settings:view', isPublic: false },
  { name: '/auth/api/admin/master/roles/save', apiGroup: 'settings:edit', isPublic: false },
  { name: '/auth/api/admin/master/roles/delete', apiGroup: 'settings:delete', isPublic: false },
  { name: '/auth/api/admin/master/apis', apiGroup: 'settings:view', isPublic: false },
  { name: '/auth/api/admin/master/apis/save', apiGroup: 'settings:edit', isPublic: false },
  { name: '/auth/api/admin/master/apis/delete', apiGroup: 'settings:delete', isPublic: false },
  { name: '/auth/api/admin/master/pages', apiGroup: 'settings:view', isPublic: false },
  { name: '/auth/api/admin/master/pages/save', apiGroup: 'settings:edit', isPublic: false },
  { name: '/auth/api/admin/master/pages/delete', apiGroup: 'settings:delete', isPublic: false },
  { name: '/auth/api/admin/master/elements', apiGroup: 'settings:view', isPublic: false },
  { name: '/auth/api/admin/master/elements/save', apiGroup: 'settings:edit', isPublic: false },
  { name: '/auth/api/admin/master/elements/delete', apiGroup: 'settings:delete', isPublic: false },
  { name: '/auth/api/admin/master/menus', apiGroup: 'settings:view', isPublic: false },
  { name: '/auth/api/admin/master/menus/save', apiGroup: 'settings:edit', isPublic: false },
  { name: '/auth/api/admin/master/menus/delete', apiGroup: 'settings:delete', isPublic: false }
];

var PAGES = [
  { name: 'Login', uiPagesGroup: '', isPublic: true },
  { name: 'Register', uiPagesGroup: '', isPublic: true },
  { name: 'Forgot Password', uiPagesGroup: '', isPublic: true },
  { name: 'Reset Password', uiPagesGroup: '', isPublic: true },
  { name: 'Activate Account', uiPagesGroup: '', isPublic: true },
  { name: 'Profile', uiPagesGroup: 'account:view', isPublic: false },
  { name: 'Change Password', uiPagesGroup: 'account:edit', isPublic: false },
  { name: 'User Roles', uiPagesGroup: 'users:view', isPublic: false },
  { name: 'Access Matrix', uiPagesGroup: 'access:view', isPublic: false },
  { name: 'Master Settings', uiPagesGroup: 'settings:view', isPublic: false },
  { name: 'Tenant Management', uiPagesGroup: 'tenants:view', isPublic: false }
];

var ELEMENTS = [
  { name: 'Assign Role Button', uiElementsGroup: 'users:edit' },
  { name: 'Remove Role Button', uiElementsGroup: 'users:edit' },
  { name: 'Toggle Access Checkbox', uiElementsGroup: 'access:edit' },
  { name: 'Toggle Module Access Checkbox', uiElementsGroup: 'access:edit' },
  { name: 'Add Role Button', uiElementsGroup: 'settings:edit' },
  { name: 'Delete Role Button', uiElementsGroup: 'settings:delete' },
  { name: 'Add API Button', uiElementsGroup: 'settings:edit' },
  { name: 'Delete API Button', uiElementsGroup: 'settings:delete' },
  { name: 'Add Page Button', uiElementsGroup: 'settings:edit' },
  { name: 'Delete Page Button', uiElementsGroup: 'settings:delete' },
  { name: 'Add Element Button', uiElementsGroup: 'settings:edit' },
  { name: 'Delete Element Button', uiElementsGroup: 'settings:delete' },
  { name: 'Add Menu Button', uiElementsGroup: 'settings:edit' },
  { name: 'Delete Menu Button', uiElementsGroup: 'settings:delete' },
  { name: 'Add Tenant Button', uiElementsGroup: 'tenants:edit' },
  { name: 'Delete Tenant Button', uiElementsGroup: 'tenants:delete' },
  { name: 'Assign User Tenant', uiElementsGroup: 'tenants:edit' }
];

var MENUS = [
  { name: 'Profile', menuGroup: 'account:view', isPublic: false },
  { name: 'User Roles', menuGroup: 'users:view', isPublic: false },
  { name: 'Access Matrix', menuGroup: 'access:view', isPublic: false },
  { name: 'Master Settings', menuGroup: 'settings:view', isPublic: false },
  { name: 'Tenant Management', menuGroup: 'tenants:view', isPublic: false }
];

var ADMIN_ROLES = ['Super Admin', 'Admin'];
var MAP_TABLES = [
  { table: 'apisRolesMapping', source: 'apis', fk: 'apiId' },
  { table: 'uiPagesRolesMapping', source: 'uiPages', fk: 'uiPageId' },
  { table: 'uiElementsRolesMapping', source: 'uiElements', fk: 'uiElementId' },
  { table: 'menuRolesMapping', source: 'menus', fk: 'menuId' }
];

async function insertIfAbsent(knex, table, where, extra) {
  var exists = await knex(table).where(where).first();
  if (exists) return exists;
  var row = Object.assign({ id: generateId() }, where, extra);
  await knex(table).insert(row);
  return row;
}

exports.up = async function (knex) {
  var now = new Date().toISOString();
  var stamp = { isActive: true, recordCreatedDate: now, recordModifiedDate: now, mtId1: MT_ALL };

  for (var i = 0; i < ROLES.length; i++) {
    await insertIfAbsent(knex, 'roles', { name: ROLES[i] }, stamp);
  }
  for (var a = 0; a < APIS.length; a++) {
    await insertIfAbsent(knex, 'apis', { name: APIS[a].name }, Object.assign({ apiGroup: APIS[a].apiGroup, isPublic: APIS[a].isPublic }, stamp));
  }
  for (var p = 0; p < PAGES.length; p++) {
    await insertIfAbsent(knex, 'uiPages', { name: PAGES[p].name }, Object.assign({ uiPagesGroup: PAGES[p].uiPagesGroup, isPublic: PAGES[p].isPublic }, stamp));
  }
  for (var e = 0; e < ELEMENTS.length; e++) {
    await insertIfAbsent(knex, 'uiElements', { name: ELEMENTS[e].name }, Object.assign({ uiElementsGroup: ELEMENTS[e].uiElementsGroup }, stamp));
  }
  for (var mu = 0; mu < MENUS.length; mu++) {
    await insertIfAbsent(knex, 'menus', { name: MENUS[mu].name }, Object.assign({ menuGroup: MENUS[mu].menuGroup, isPublic: MENUS[mu].isPublic }, stamp));
  }

  // god-mode: map admin roles to every api/page/element/menu that exists now.
  var adminRoles = await knex('roles').whereIn('name', ADMIN_ROLES).select('id');
  for (var t = 0; t < MAP_TABLES.length; t++) {
    var M = MAP_TABLES[t];
    var items = await knex(M.source).select('id');
    for (var r = 0; r < adminRoles.length; r++) {
      for (var it = 0; it < items.length; it++) {
        var where = { roleId: adminRoles[r].id };
        where[M.fk] = items[it].id;
        await insertIfAbsent(knex, M.table, where, { recordCreatedDate: now, recordModifiedDate: now, mtId1: MT_ALL });
      }
    }
  }
};

exports.down = async function (knex) {
  var adminRoles = await knex('roles').whereIn('name', ADMIN_ROLES).select('id');
  var adminIds = adminRoles.map(function (r) { return r.id; });
  for (var t = 0; t < MAP_TABLES.length; t++) {
    await knex(MAP_TABLES[t].table).whereIn('roleId', adminIds).del();
  }
  await knex('menus').whereIn('name', MENUS.map(function (x) { return x.name; })).del();
  await knex('uiElements').whereIn('name', ELEMENTS.map(function (x) { return x.name; })).del();
  await knex('uiPages').whereIn('name', PAGES.map(function (x) { return x.name; })).del();
  await knex('apis').whereIn('name', APIS.map(function (x) { return x.name; })).del();
  await knex('roles').whereIn('name', ROLES).del();
};

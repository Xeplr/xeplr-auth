// Makes the built-in account-menu items data-driven (seeded here) instead of
// hardcoded in @xeplr/ui-account's AccountMenu.jsx.
//
// "Profile"/"Change Password" already exist from 0019, but isPublic:false with
// no non-admin role mapping means only Admin/Super Admin actually see them
// today — everyone else (Viewer, Creator, or any role a consuming app adds
// LATER, e.g. BI's CompanyAdmin) gets nothing. Flipping isPublic:true fixes
// this the right way: getUserAccess() (accessService.js) unions every
// isPublic:true menu into EVERY authenticated user's access.menus regardless
// of role — unlike enumerating role ids (0019's god-mode approach), this
// can't miss a role that doesn't exist yet when this migration runs.
//
// "Notifications" (basic tier, a visibility gate only — it has no page) and
// "Admin" (admin tier, the account-menu's entry point into the admin area)
// are new. The public auth pages (Login/Register/…) get menu rows too for a
// complete catalog — @xeplr/ui-account's AccountMenu ignores names it has no
// route mapping for, so this is harmless, just consistent bookkeeping.
var crypto = require('crypto');
function generateId() { return crypto.randomBytes(12).toString('hex').substring(0, 25); }
var MT_ALL = '*';

var EXISTING_BASIC_ITEMS = ['Profile', 'Change Password'];   // seeded by 0019 — fixing isPublic here

var NEW_BASIC_ITEMS = [
  { name: 'Notifications',   menuGroup: 'account:view' },
  { name: 'Login',           menuGroup: '' },
  { name: 'Register',        menuGroup: '' },
  { name: 'Forgot Password', menuGroup: '' },
  { name: 'Reset Password',  menuGroup: '' },
  { name: 'Activate Account', menuGroup: '' },
  { name: 'Not Activated',   menuGroup: '' }
];

var NEW_ADMIN_ITEMS = [
  { name: 'Admin', menuGroup: 'admin:view' }
];

var ADMIN_ROLES = ['Super Admin', 'Admin'];

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

  // Basic tier — isPublic:true, no role mapping needed (see accessService.js getPublicItems()).
  for (var i = 0; i < NEW_BASIC_ITEMS.length; i++) {
    var item = NEW_BASIC_ITEMS[i];
    await insertIfAbsent(knex, 'menus', { name: item.name }, Object.assign({ menuGroup: item.menuGroup, isPublic: true }, stamp));
  }
  await knex('menus').whereIn('name', EXISTING_BASIC_ITEMS).update({ isPublic: true });
  // Same fix for the uiPages catalog (hasPage() has the identical bug).
  await knex('uiPages').whereIn('name', EXISTING_BASIC_ITEMS).update({ isPublic: true });

  // Admin tier — god-mode mapped to ADMIN_ROLES, same pattern as 0019.
  var adminRows = [];
  for (var a = 0; a < NEW_ADMIN_ITEMS.length; a++) {
    var row = await insertIfAbsent(knex, 'menus', { name: NEW_ADMIN_ITEMS[a].name }, Object.assign({ menuGroup: NEW_ADMIN_ITEMS[a].menuGroup, isPublic: false }, stamp));
    adminRows.push(row);
  }
  var adminRoles = await knex('roles').whereIn('name', ADMIN_ROLES).select('id');
  for (var r = 0; r < adminRoles.length; r++) {
    for (var m = 0; m < adminRows.length; m++) {
      await insertIfAbsent(knex, 'menuRolesMapping', { roleId: adminRoles[r].id, menuId: adminRows[m].id }, { recordCreatedDate: now, recordModifiedDate: now, mtId1: MT_ALL });
    }
  }
};

exports.down = async function (knex) {
  var newNames = NEW_BASIC_ITEMS.map(function (x) { return x.name; }).concat(NEW_ADMIN_ITEMS.map(function (x) { return x.name; }));
  var rows = await knex('menus').whereIn('name', newNames).select('id');
  var ids = rows.map(function (r) { return r.id; });
  if (ids.length) await knex('menuRolesMapping').whereIn('menuId', ids).del();
  await knex('menus').whereIn('name', newNames).del();

  await knex('menus').whereIn('name', EXISTING_BASIC_ITEMS).update({ isPublic: false });
  await knex('uiPages').whereIn('name', EXISTING_BASIC_ITEMS).update({ isPublic: false });
};

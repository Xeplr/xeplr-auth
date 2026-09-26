// Auth's own routes are checked against the catalog, like any app's: signed
// in is not enough. Real Postgres (auth's own migrations, 0012 included) and a
// stand-in for the token check, the same way systemScope.test.js runs.
var { test, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var http = require('node:http');
var express = require('express');
var knexLib = require('knex');

process.env.AUTH_TENANT_HEADER = 'x-company-id';

var utils = require('@xeplr/utils');
var store = new Map();
utils.cache.get = async function(k) { return store.has(k) ? JSON.parse(store.get(k)) : null; };
utils.cache.set = async function(k, v) { store.set(k, JSON.stringify(v)); };
utils.cache.del = async function(k) { store.delete(k); };
utils.cache.delPattern = async function(p) {
  var re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  Array.from(store.keys()).forEach(function(k) { if (re.test(k)) store.delete(k); });
};

require.cache[require.resolve('../lib/authMiddleware')] = {
  id: 'authMiddleware', loaded: true,
  exports: function(req, res, next) { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }
};

var { BaseModel } = require('@xeplr/db');

var DB = 'xeplr_auth_routes_' + process.pid;
var admin, knex, server, base, skip = null;

function migrate(f) { return knex.raw(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8')); }

async function userWithRole(id, roleName) {
  var role = await knex('roles').where({ name: roleName }).first();
  await knex('users').insert({ id: id, email: id + '@x.y', isActive: true });
  await knex('userRolesMapping').insert({ id: 'm' + id, userId: id, roleId: role.id, isActive: true, mtId1: '*' });
  return { id: id, roles: [roleName] };
}

async function call(user, method, url, body) {
  var res = await fetch(base + url, {
    method: method,
    headers: Object.assign({ 'x-test-user': JSON.stringify(user), 'x-company-id': 'c1' },
      body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, body: json };
}

var viewer, adminUser;

before(async function() {
  admin = knexLib({ client: 'pg', connection: { database: 'postgres' } });
  try { await admin.raw('SELECT 1'); } catch (err) { skip = 'no Postgres available (' + err.message + ')'; return; }
  await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  await admin.raw('CREATE DATABASE ??', [DB]);
  knex = knexLib({ client: 'pg', connection: { database: DB } });
  for (var f of ['0001_extensions.sql', '0002_users.sql', '0003_catalog_tables.sql', '0004_role_mappings.sql',
                 '0005_user_tenants_mapping.sql', '0006_seed_catalog.sql', '0007_license_module.sql',
                 '0009_menu_labels.sql', '0010_system_scope.sql', '0011_verify_api.sql', '0012_default_role_access.sql', '0013_mapping_state.sql']) {
    await migrate(f);
  }
  BaseModel.knex(knex);
  viewer = await userWithRole('uviewer', 'Viewer');
  adminUser = await userWithRole('uadmin', 'Admin');

  var app = express();
  app.use(express.json());
  app.use('/auth/api/admin', require('../lib/adminRouter')());
  app.use('/auth/api', require('../lib/authRouter')());
  server = http.createServer(app);
  await new Promise(function(r) { server.listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async function() {
  if (server) server.close();
  if (knex) await knex.destroy();
  if (admin && !skip) await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  if (admin) await admin.destroy();
});

test('every role reaches its own account routes', async function(t) {
  if (skip) return t.skip(skip);
  assert.equal((await call(viewer, 'GET', '/auth/api/me')).status, 200);
  assert.equal((await call(viewer, 'GET', '/auth/api/profile')).status !== 403, true);
});

test('a Viewer cannot call admin routes just by being signed in', async function(t) {
  if (skip) return t.skip(skip);
  var r = await call(viewer, 'GET', '/auth/api/admin/users');
  assert.equal(r.status, 403); assert.equal(r.body.code, 'HIDDEN');
  r = await call(viewer, 'POST', '/auth/api/admin/user-role', { userId: 'uviewer', roleId: 'x', assign: true });
  assert.equal(r.status, 403, 'a Viewer must not hand itself a role');
  r = await call(viewer, 'POST', '/auth/api/admin/access-role', {});
  assert.equal(r.status, 403);
});

test('an Admin reaches the admin routes', async function(t) {
  if (skip) return t.skip(skip);
  assert.equal((await call(adminUser, 'GET', '/auth/api/admin/users')).status, 200);
  assert.equal((await call(adminUser, 'GET', '/auth/api/admin/roles')).status, 200);
});

test('system routes stay Super Admin only, even for an Admin', async function(t) {
  if (skip) return t.skip(skip);
  var r = await call(adminUser, 'POST', '/auth/api/admin/master/roles/copy', { roleIds: [], companyIds: [] });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'SYSTEM_SCOPE');
});

test('0012 maps no system API to any role but Super Admin, and re-running changes nothing', async function(t) {
  if (skip) return t.skip(skip);
  var count = async function() { return Number((await knex('apisRolesMapping').count('* as n'))[0].n); };
  var before = await count();
  await migrate('0012_default_role_access.sql');
  assert.equal(await count(), before);
  var leaked = await knex('apisRolesMapping as m').join('apis as a', 'a.id', 'm.apiId').join('roles as r', 'r.id', 'm.roleId')
    .where('a.scope', 'system').whereIn('r.name', ['Editor', 'Viewer']).count('* as n');
  assert.equal(Number(leaked[0].n), 0);
});

// ── Disabled: stored on the mapping row, answered by the check ─────────────

test('Disabled for a role: stored, listed, refused by the check, shown greyed, and cleared again', async function(t) {
  if (skip) return t.skip(skip);
  var service = require('../lib/accessService');
  var viewerRole = (await knex('roles').where({ name: 'Viewer' }).first()).id;
  await knex('apis').insert({ id: 'apireports000000000000001', name: 'GET /reports', apiGroup: 'reports:view', isPublic: false, isActive: true, mtId1: '*' });
  await knex('menus').insert({ id: 'menureports00000000000001', name: 'Reports', menuGroup: 'reports:view', isPublic: false, isActive: true, mtId1: '*' });
  await knex('apisRolesMapping').insert({ id: 'mapreports00000000000001', roleId: viewerRole, apiId: 'apireports000000000000001', isActive: true, mtId1: '*' });
  await knex('menuRolesMapping').insert({ id: 'mnureports00000000000001', roleId: viewerRole, menuId: 'menureports00000000000001', isActive: true, mtId1: '*' });
  store.clear();

  assert.equal((await service.requestApiState('uviewer', 'GET', '/reports')).state, 'enabled');

  var r = await call(viewer, 'POST', '/auth/api/admin/module-state', { scope: 'role', module: 'reports', action: 'view', roleId: viewerRole, state: 'disabled' });
  assert.equal(r.status, 403, 'a Viewer cannot change states');

  r = await call(adminUser, 'POST', '/auth/api/admin/module-state', { scope: 'role', module: 'reports', action: 'view', roleId: viewerRole, state: 'disabled' });
  assert.equal(r.status, 200);
  assert.equal(r.body.changed, 2, 'the API and the menu of that module/action');

  r = await call(adminUser, 'GET', '/auth/api/admin/module-states?scope=role');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.filter(function(x) { return x.roleId === viewerRole; }),
    [{ module: 'reports', action: 'view', roleId: viewerRole, state: 'disabled' }]);

  assert.equal((await service.requestApiState('uviewer', 'GET', '/reports')).state, 'disabled');

  var me = (await call(viewer, 'GET', '/auth/api/me')).body.access;
  assert.equal(me.apis.indexOf('GET /reports'), -1, 'not in the usable list');
  assert.deepEqual(me.disabled.apis, ['GET /reports']);
  var menu = me.menuItems.filter(function(m) { return m.name === 'Reports'; })[0];
  assert.ok(menu, 'still on the rail');
  assert.equal(menu.disabled, true, 'marked so the UI can grey it out');

  r = await call(adminUser, 'POST', '/auth/api/admin/module-state', { scope: 'role', module: 'reports', action: 'view', roleId: viewerRole, state: null });
  assert.equal(r.status, 200);
  assert.equal((await service.requestApiState('uviewer', 'GET', '/reports')).state, 'enabled');
  me = (await call(viewer, 'GET', '/auth/api/me')).body.access;
  assert.notEqual(me.apis.indexOf('GET /reports'), -1);
  assert.deepEqual(me.disabled.apis, []);
});

test('module states: only roles for now, and hidden is not a state to store', async function(t) {
  if (skip) return t.skip(skip);
  var r = await call(adminUser, 'GET', '/auth/api/admin/module-states?scope=workspace&scopeId=w1');
  assert.equal(r.status, 400); assert.equal(r.body.code, 'SCOPE_NOT_SUPPORTED');
  r = await call(adminUser, 'POST', '/auth/api/admin/module-state', { scope: 'role', module: 'reports', action: 'view', roleId: 'x', state: 'hidden' });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'BAD_STATE');
  r = await call(adminUser, 'POST', '/auth/api/admin/module-state', { scope: 'role', module: 'reports', roleId: 'x', state: 'disabled' });
  assert.equal(r.status, 400);
});

test('0013 re-runs without changing anything', async function(t) {
  if (skip) return t.skip(skip);
  await migrate('0013_mapping_state.sql');
  await assert.rejects(knex('apisRolesMapping').update({ state: 'bogus' }).where({ id: 'mapreports00000000000001' }), /state_check/);
});

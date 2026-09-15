// Menu items: key vs label, order, hidden — the service, what a user's access
// carries, and the Super Admin routes. Real Postgres (auth's own migrations),
// an in-memory cache, and a stand-in for the token check.

var { test, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var http = require('node:http');
var express = require('express');
var knexLib = require('knex');

// ── an in-memory cache, and a token check that trusts a test header ───────
var store = new Map();
var utils = require('@xeplr/utils');
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
var { createMenuService, visibleItems } = require('../lib/menuService');
var accessService = require('../lib/accessService');
var Menu = require('../models/Menu');
var MenuRolesMapping = require('../models/MenuRolesMapping');

var DB = 'xeplr_auth_menus_' + process.pid;
var admin, knex, server, base, skip = null, userId, roleId;

async function call(method, url, body, roles) {
  var res = await fetch(base + url, {
    method: method,
    headers: Object.assign({ 'x-test-user': JSON.stringify({ id: userId, roles: roles || ['Super Admin'] }) }, body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

before(async function() {
  admin = knexLib({ client: 'pg', connection: { database: 'postgres' } });
  try { await admin.raw('SELECT 1'); } catch (err) { skip = 'no Postgres available (' + err.message + ')'; return; }
  await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  await admin.raw('CREATE DATABASE ??', [DB]);
  knex = knexLib({ client: 'pg', connection: { database: DB } });
  for (var f of ['0001_extensions.sql', '0002_users.sql', '0003_catalog_tables.sql', '0004_role_mappings.sql', '0009_menu_labels.sql']) {
    await knex.raw(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  }
  BaseModel.knex(knex);

  userId = 'u000000000000000000000001';
  roleId = 'r000000000000000000000001';
  await knex('users').insert({ id: userId, email: 'a@b.c', isActive: true });
  await knex('roles').insert({ id: roleId, name: 'Creator', isActive: true });
  await knex('userRolesMapping').insert({ id: 'x1', userId: userId, roleId: roleId, isActive: true });
  var menus = [
    { id: 'm1', name: 'Home', isPublic: true, sortOrder: 1 },
    { id: 'm2', name: 'Tasks', isPublic: false, sortOrder: 2 },
    { id: 'm3', name: 'Reports', isPublic: false },
    { id: 'm4', name: 'Secret', isPublic: false }
  ];
  await knex('menus').insert(menus.map(function(m) { return Object.assign({ isActive: true, menuGroup: '' }, m); }));
  await knex('menuRolesMapping').insert([
    { id: 'mr1', menuId: 'm2', roleId: roleId, isActive: true },
    { id: 'mr2', menuId: 'm3', roleId: roleId, isActive: true }
  ]);

  var app = express();
  app.use(express.json());
  app.use('/admin', require('../lib/adminRouter')());
  server = http.createServer(app);
  await new Promise(function(r) { server.listen(0, r); });
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async function() {
  if (server) await new Promise(function(r) { server.close(r); });
  if (knex) await knex.destroy();
  if (admin && !skip) await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  if (admin) await admin.destroy();
});

test('visibleItems: the label shown, hidden ones out, numbered first, one row per key', function() {
  var items = visibleItems([
    { name: 'B', label: 'Bee' },
    { name: 'A', sortOrder: 2 },
    { name: 'Z', sortOrder: 1, label: 'Zed' },
    { name: 'H', isHidden: true, sortOrder: 0 },
    { name: 'A', sortOrder: 9 },
    null
  ]);
  assert.deepEqual(items, [
    { name: 'Z', label: 'Zed', sortOrder: 1 },
    { name: 'A', label: 'A', sortOrder: 2 },
    { name: 'B', label: 'Bee', sortOrder: null }
  ]);
});

test('menu items', async function(t) {
  if (skip) { t.skip(skip); return; }

  await t.test('a user\'s access: keys to match on, labels to show, in order', async function() {
    var access = await accessService.getUserAccess(userId);
    assert.deepEqual(access.menus, ['Home', 'Tasks', 'Reports']);
    assert.deepEqual(access.menuItems.map(function(m) { return m.label; }), ['Home', 'Tasks', 'Reports']);
  });

  await t.test('rename, reorder, hide — and the next access answer shows it', async function() {
    var res = await call('POST', '/admin/menu-items', { items: [
      { name: 'Tasks', label: '  TSK  ', sortOrder: 0 },
      { name: 'Home', isHidden: true }
    ] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.changed, 2);
    var access = await accessService.getUserAccess(userId);
    assert.deepEqual(access.menus, ['Tasks', 'Reports'], 'hidden Home is gone; the key stays "Tasks"');
    assert.deepEqual(access.menuItems[0], { name: 'Tasks', label: 'TSK', sortOrder: 0 });
  });

  await t.test('the admin list has everything, hidden ones included', async function() {
    var res = await call('GET', '/admin/menu-items');
    assert.equal(res.status, 200);
    var home = res.body.find(function(m) { return m.name === 'Home'; });
    assert.equal(home.isHidden, true);
    assert.equal(res.body[0].shown, 'TSK');
    assert.ok(res.body.some(function(m) { return m.name === 'Secret'; }));
  });

  await t.test('add: a new item for everyone, placed last; an existing key is relabelled and shown again', async function() {
    var added = await call('POST', '/admin/menu-items/add', { name: 'form:crop', label: 'Crops' });
    assert.deepEqual(added.body, { name: 'form:crop', created: true });
    var row = await knex('menus').where({ name: 'form:crop' }).first();
    assert.equal(row.isPublic, true);
    assert.equal(row.sortOrder, 2, 'after the highest position (Home is 1)');
    assert.ok((await accessService.getUserAccess(userId)).menus.includes('form:crop'));

    var again = await call('POST', '/admin/menu-items/add', { name: 'Home', label: 'Start' });
    assert.deepEqual(again.body, { name: 'Home', created: false });
    var access = await accessService.getUserAccess(userId);
    assert.ok(access.menuItems.some(function(m) { return m.name === 'Home' && m.label === 'Start'; }));
  });

  await t.test('remove: the item and its role mappings', async function() {
    await knex('menuRolesMapping').insert({ id: 'mr9', menuId: (await knex('menus').where({ name: 'form:crop' }).first()).id, roleId: roleId, isActive: true });
    assert.deepEqual((await call('POST', '/admin/menu-items/remove', { name: 'form:crop' })).body, { removed: true });
    assert.equal((await knex('menus').where({ name: 'form:crop' })).length, 0);
    assert.equal((await knex('menuRolesMapping').where({ id: 'mr9' })).length, 0);
    assert.deepEqual((await call('POST', '/admin/menu-items/remove', { name: 'nope' })).body, { removed: false });
  });

  await t.test('refused: not Super Admin, a missing key, a bad order, a label too long', async function() {
    assert.equal((await call('GET', '/admin/menu-items', null, ['Creator'])).status, 403);
    assert.equal((await call('POST', '/admin/menu-items', { items: [{ label: 'x' }] })).status, 400);
    assert.equal((await call('POST', '/admin/menu-items', { items: [] })).status, 400);
    assert.equal((await call('POST', '/admin/menu-items', { items: [{ name: 'Tasks', sortOrder: 1.5 }] })).status, 400);
    assert.equal((await call('POST', '/admin/menu-items', { items: [{ name: 'Tasks', label: 'x'.repeat(256) }] })).status, 400);
    assert.equal((await call('POST', '/admin/menu-items/add', { label: 'no key' })).status, 400);
    assert.equal((await call('POST', '/admin/menu-items/add', { name: 'x'.repeat(256) })).status, 400);
    assert.equal((await call('POST', '/admin/menu-items/remove', {})).status, 400);
  });

  await t.test('a label cleared shows the key again; nothing to change is fine', async function() {
    var svc = createMenuService({ Menu: Menu, MenuRolesMapping: MenuRolesMapping, clearAll: async function() {} });
    await svc.update([{ name: 'Tasks', label: null, sortOrder: null }, { name: 'Reports' }]);
    var list = await svc.list();
    assert.equal(list.find(function(m) { return m.name === 'Tasks'; }).shown, 'Tasks');
  });

  await t.test('a server error is not leaked', async function() {
    var broken = createMenuService({ Menu: { query: function() { throw new Error('db exploded'); } }, MenuRolesMapping: MenuRolesMapping, clearAll: async function() {} });
    await assert.rejects(broken.list(), /db exploded/);
  });
});

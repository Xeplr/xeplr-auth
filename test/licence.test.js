// Licensed modules: a host says which sold modules a user may use, and access
// leaves out every other module's rows. Real Postgres (auth's own migrations,
// 0007 included), an in-memory cache, the real access service and gates.
var { test, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var http = require('node:http');
var express = require('express');
var knexLib = require('knex');

var store = new Map();
var utils = require('@xeplr/utils');
utils.cache.get = async function(k) { return store.has(k) ? JSON.parse(store.get(k)) : null; };
utils.cache.set = async function(k, v) { store.set(k, JSON.stringify(v)); };
utils.cache.del = async function(k) { store.delete(k); };
utils.cache.delPattern = async function(p) {
  var re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  Array.from(store.keys()).forEach(function(k) { if (re.test(k)) store.delete(k); });
};

var { BaseModel } = require('@xeplr/db');
var accessService = require('../lib/accessService');
var licence = require('../lib/licence');
var { accessGate } = require('../lib/accessMiddleware');

var DB = 'xeplr_auth_licence_' + process.pid;
var admin, knex, skip = null;
var USER = 'u000000000000000000000001';
var ROLE = 'r000000000000000000000001';
var paidFor = null;   // what the host answers for USER

before(async function() {
  admin = knexLib({ client: 'pg', connection: { database: 'postgres' } });
  try { await admin.raw('SELECT 1'); } catch (err) { skip = 'no Postgres available (' + err.message + ')'; return; }
  await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  await admin.raw('CREATE DATABASE ??', [DB]);
  knex = knexLib({ client: 'pg', connection: { database: DB } });
  for (var f of ['0001_extensions.sql', '0002_users.sql', '0003_catalog_tables.sql', '0004_role_mappings.sql',
                 '0007_license_module.sql', '0009_menu_labels.sql', '0010_system_scope.sql', '0013_mapping_state.sql']) {
    await knex.raw(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  }
  BaseModel.knex(knex);

  await knex('users').insert({ id: USER, email: 'a@b.c', isActive: true });
  await knex('roles').insert({ id: ROLE, name: 'Creator', isActive: true });
  await knex('userRolesMapping').insert({ id: 'ur1', userId: USER, roleId: ROLE, isActive: true });

  // One API and one menu per module, all mapped to the user's role.
  var rows = [['core', 'GET /me', 'Home'], ['bi', 'GET /reports', 'Reports'], ['xflow', 'GET /xflow/flows', 'X-Flow']];
  for (var i = 0; i < rows.length; i++) {
    await knex('apis').insert({ id: 'a' + i, name: rows[i][1], apiGroup: 'g', isActive: true, licenseModule: rows[i][0] });
    await knex('apisRolesMapping').insert({ id: 'ar' + i, apiId: 'a' + i, roleId: ROLE, isActive: true });
    await knex('menus').insert({ id: 'm' + i, name: rows[i][2], menuGroup: '', isActive: true, licenseModule: rows[i][0] });
    await knex('menuRolesMapping').insert({ id: 'mr' + i, menuId: 'm' + i, roleId: ROLE, isActive: true });
  }
  // Public to every role, but sold as X-Flow; and an unmapped X-Flow API.
  await knex('menus').insert({ id: 'mp', name: 'Flow Gallery', menuGroup: '', isActive: true, isPublic: true, licenseModule: 'xflow' });
  await knex('apis').insert({ id: 'au', name: 'GET /xflow/catalog', apiGroup: 'g', isActive: true, licenseModule: 'xflow' });
});

after(async function() {
  licence.use(null);
  if (knex) await knex.destroy();
  if (admin) { if (!skip) await admin.raw('DROP DATABASE IF EXISTS ??', [DB]); await admin.destroy(); }
});

function fresh() { store.clear(); }

test('nothing registered: every module is allowed, as before', async function(t) {
  if (skip) return t.skip(skip);
  licence.use(null);
  fresh();
  var access = await accessService.getUserAccess(USER);
  assert.deepEqual(access.apis.sort(), ['GET /me', 'GET /reports', 'GET /xflow/flows']);
  assert.deepEqual(access.menus.sort(), ['Flow Gallery', 'Home', 'Reports', 'X-Flow']);
  assert.equal(await accessService.userApiState(USER, 'GET /xflow/flows'), 'enabled');
});

test('a host licence leaves out other modules: not greyed, not usable', async function(t) {
  if (skip) return t.skip(skip);
  var asked = [];
  licence.use({ modulesFor: async function(userId) { asked.push(userId); return paidFor; } });
  paidFor = ['bi'];
  fresh();

  var access = await accessService.getUserAccess(USER);
  assert.deepEqual(access.apis.sort(), ['GET /me', 'GET /reports'], 'core is always in');
  assert.deepEqual(access.menus.sort(), ['Home', 'Reports'], 'a public menu of an unlicensed module is left out too');
  assert.deepEqual(access.disabled.menus, [], 'unlicensed is not shown greyed out');
  assert.ok(asked.indexOf(USER) !== -1, 'asked about this user');

  assert.equal(await accessService.userApiState(USER, 'GET /reports'), 'enabled');
  assert.equal(await accessService.userApiState(USER, 'GET /xflow/flows'), 'unlicensed');
  assert.equal(await accessService.userApiState(USER, 'GET /xflow/catalog'), 'unlicensed', 'no role mapping does not open a sold module');
  assert.equal(await accessService.userApiState(USER, 'GET /not-in-catalog'), 'enabled', 'not in the catalog: open, as before');
});

test('the answer is the host\'s: a seat given reaches the user once the cache clears', async function(t) {
  if (skip) return t.skip(skip);
  licence.use({ modulesFor: async function() { return paidFor; } });
  paidFor = [];
  fresh();
  assert.deepEqual((await accessService.getUserAccess(USER)).menus, ['Home'], 'nothing paid for: core only');

  paidFor = ['bi', 'xflow'];
  await accessService.clearUserAccess(USER);
  assert.deepEqual((await accessService.getUserAccess(USER)).menus.sort(), ['Flow Gallery', 'Home', 'Reports', 'X-Flow']);
});

test('auth\'s own gate answers 403 UNLICENSED', async function(t) {
  if (skip) return t.skip(skip);
  licence.use({ modulesFor: async function() { return ['bi']; } });
  fresh();
  var app = express();
  app.use(function(req, res, next) { req.user = { id: USER }; next(); });
  app.use(accessGate());
  app.get('*splat', function(req, res) { res.json({ ok: true }); });
  var server = http.createServer(app).listen(0);
  var base = 'http://127.0.0.1:' + server.address().port;
  try {
    var refused = await fetch(base + '/xflow/flows');
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: 'This is not part of your licence', code: 'UNLICENSED' });
    assert.equal((await fetch(base + '/reports')).status, 200);
  } finally {
    server.close();
  }
});

test('use() refuses something that is not a function', function() {
  assert.throws(function() { licence.use({ modulesFor: ['bi'] }); }, /must be a function/);
});

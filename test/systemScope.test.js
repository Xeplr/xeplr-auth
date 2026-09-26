// System scope: system APIs and system roles are Super Admin only. Real
// Postgres (auth's own migrations, 0010 included) and a stand-in for the token
// check, the same way menuItems.test.js runs.
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

// These users exist only in a header, with no role mappings in the database,
// so the catalog check on admin routes is let through here: this suite is
// about scope, not access. accessGate is tested in authRoutesAccess.test.js.
require('../lib/accessService').requestApiState = async function() { return { api: null, state: 'enabled' }; };

require.cache[require.resolve('../lib/authMiddleware')] = {
  id: 'authMiddleware', loaded: true,
  exports: function(req, res, next) { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }
};

var { BaseModel } = require('@xeplr/db');
var { isSystemRequest, systemScopeGuard } = require('../lib/systemScope');

var DB = 'xeplr_auth_scope_' + process.pid;
var admin, knex, server, base, skip = null;
var SA = ['Super Admin'], CA = ['CompanyAdmin'];

async function call(method, url, body, roles) {
  var res = await fetch(base + url, {
    method: method,
    // Always inside a company: roles belong to the company they are made in.
    headers: Object.assign({ 'x-test-user': JSON.stringify({ id: 'u1', roles: roles || [] }), 'x-company-id': 'c1' },
      body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}
function migrate(f) { return knex.raw(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8')); }
async function roleId(name) { return (await knex('roles').where({ name: name }).first()).id; }

before(async function() {
  admin = knexLib({ client: 'pg', connection: { database: 'postgres' } });
  try { await admin.raw('SELECT 1'); } catch (err) { skip = 'no Postgres available (' + err.message + ')'; return; }
  await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  await admin.raw('CREATE DATABASE ??', [DB]);
  knex = knexLib({ client: 'pg', connection: { database: DB } });
  for (var f of ['0001_extensions.sql', '0002_users.sql', '0003_catalog_tables.sql', '0004_role_mappings.sql',
                 '0006_seed_catalog.sql', '0007_license_module.sql', '0010_system_scope.sql']) {
    await migrate(f);
  }
  BaseModel.knex(knex);
  await knex('roles').insert({ id: 'rca000000000000000000001', name: 'CompanyAdmin', isActive: true, mtId1: '*' });
  await knex('users').insert({ id: 'u2', email: 'x@y.z', isActive: true });

  var app = express();
  app.use(express.json());
  app.use('/auth/api/admin', require('../lib/adminRouter')());
  // A product's own route, guarded the way a product would mount it.
  var product = express.Router();
  product.use(function(req, res, next) { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); });
  product.use(systemScopeGuard());
  product.get('/licences', function(req, res) { res.json({ ok: true }); });
  product.get('/reports', function(req, res) { res.json({ ok: true }); });
  app.use('/api', product);
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

test('a name is a path (every method) or "METHOD path" (that method only)', function() {
  var names = ['POST /auth/api/admin/master/roles', '/api/licences'];
  assert.equal(isSystemRequest(names, 'POST', '/auth/api/admin/master/roles'), true);
  assert.equal(isSystemRequest(names, 'GET', '/auth/api/admin/master/roles'), false);
  assert.equal(isSystemRequest(names, 'GET', '/api/licences'), true);
  assert.equal(isSystemRequest(names, 'DELETE', '/api/licences/'), true, 'a trailing slash is the same path');
  assert.equal(isSystemRequest(names, 'GET', '/api/licences/x'), false, 'a longer path is not the same API');
});

test('0010 marks Super Admin and the role routes as system, and re-running changes nothing', async function(t) {
  if (skip) return t.skip(skip);
  assert.equal((await knex('roles').where({ name: 'Super Admin' }).first()).scope, 'system');
  assert.equal((await knex('roles').where({ name: 'CompanyAdmin' }).first()).scope, 'company');
  var sys = await knex('apis').where({ scope: 'system' }).orderBy('name').pluck('name');
  assert.deepEqual(sys, ['/auth/api/admin/master/apis/scope', '/auth/api/admin/master/roles/copy', '/auth/api/admin/master/roles/delete', 'POST /auth/api/admin/master/roles']);
  await migrate('0010_system_scope.sql');
  assert.equal(Number((await knex('apis').where({ scope: 'system' }).count('* as n'))[0].n), 4);
});

test('only Super Admin creates, renames and deletes roles', async function(t) {
  if (skip) return t.skip(skip);
  var refused = await call('POST', '/auth/api/admin/master/roles', { name: 'Sneaky' }, CA);
  assert.equal(refused.status, 403);
  assert.equal(await knex('roles').where({ name: 'Sneaky' }).first(), undefined, 'nothing written');
  var made = await call('POST', '/auth/api/admin/master/roles', { name: 'Workspace Admin' }, SA);
  assert.equal(made.status, 200);
  assert.equal((await knex('roles').where({ id: made.body.id }).first()).scope, 'company', 'company is the default');
  var del = await call('POST', '/auth/api/admin/master/roles/delete', { id: made.body.id }, CA);
  assert.equal(del.status, 403);
  var gone = await call('POST', '/auth/api/admin/master/roles/delete', { id: made.body.id }, SA);
  assert.equal(gone.status, 200);
});

test('the Super Admin role itself cannot be deleted, even by Super Admin', async function(t) {
  if (skip) return t.skip(skip);
  var res = await call('POST', '/auth/api/admin/master/roles/delete', { id: await roleId('Super Admin') }, SA);
  assert.equal(res.status, 400);
  assert.ok(await knex('roles').where({ name: 'Super Admin' }).first());
});

test('system roles are invisible to everyone but Super Admin', async function(t) {
  if (skip) return t.skip(skip);
  var asCa = await call('GET', '/auth/api/admin/roles', null, CA);
  assert.equal(asCa.status, 200);
  assert.equal(asCa.body.some(function(r) { return r.name === 'Super Admin'; }), false);
  var asCaMaster = await call('GET', '/auth/api/admin/master/roles', null, CA);
  assert.equal(asCaMaster.status, 200, 'listing stays open: only POST on this path is a system action');
  assert.equal(asCaMaster.body.some(function(r) { return r.name === 'Super Admin'; }), false);
  var asSa = await call('GET', '/auth/api/admin/roles', null, SA);
  assert.equal(asSa.body.find(function(r) { return r.name === 'Super Admin'; }).scope, 'system');
});

test('only Super Admin assigns a system role', async function(t) {
  if (skip) return t.skip(skip);
  var sa = await roleId('Super Admin');
  var refused = await call('POST', '/auth/api/admin/user-role', { userId: 'u2', roleId: sa, assign: true }, CA);
  assert.equal(refused.status, 403);
  assert.equal(await knex('userRolesMapping').where({ userId: 'u2', roleId: sa }).first(), undefined);
  var ok = await call('POST', '/auth/api/admin/user-role', { userId: 'u2', roleId: sa, assign: true }, SA);
  assert.equal(ok.status, 200);
  var company = await call('POST', '/auth/api/admin/user-role', { userId: 'u2', roleId: await roleId('CompanyAdmin'), assign: true }, CA);
  assert.equal(company.status, 200, 'company roles work as before');
});

test('system APIs are never offered or granted to a role', async function(t) {
  if (skip) return t.skip(skip);
  var items = await call('GET', '/auth/api/admin/access-items', null, SA);
  var names = items.body.apis.map(function(a) { return a.name; });
  assert.equal(names.indexOf('/auth/api/admin/master/roles/delete'), -1);
  assert.equal(names.indexOf('POST /auth/api/admin/master/roles'), -1);
  assert.notEqual(names.indexOf('/auth/api/admin/master/roles'), -1, 'the company-scope listing row is still offered');
  var sysApi = await knex('apis').where({ scope: 'system' }).first();
  var ca = await roleId('CompanyAdmin');
  var direct = await call('POST', '/auth/api/admin/access-role', { type: 'apis', itemId: sysApi.id, roleId: ca, assign: true }, SA);
  assert.equal(direct.status, 400);
  var bulk = await call('POST', '/auth/api/admin/module-role', { module: 'settings', action: 'delete', roleId: ca, assign: true }, SA);
  assert.equal(bulk.status, 200);
  var granted = await knex('apisRolesMapping as m').join('apis as a', 'a.id', 'm.apiId').where('m.roleId', ca).pluck('a.name');
  assert.equal(granted.indexOf('/auth/api/admin/master/roles/delete'), -1, 'the system API in the group is skipped');
  assert.ok(granted.length > 0, 'the company APIs in the same group are granted');
});

test("a product's system API is a catalog row, with no library change", async function(t) {
  if (skip) return t.skip(skip);
  assert.equal((await call('GET', '/api/licences', null, CA)).status, 200, 'not a system API yet');
  // What a product's migrations-auth file would insert:
  await knex('apis').insert({ id: 'papi00000000000000000001', name: '/api/licences', apiGroup: 'licences:view', scope: 'system', isActive: true });
  await require('../lib/accessService').clearAccessRules?.();
  store.clear();
  var refused = await call('GET', '/api/licences', null, CA);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'SYSTEM_SCOPE');
  assert.equal((await call('GET', '/api/licences', null, SA)).status, 200);
  assert.equal((await call('GET', '/api/reports', null, CA)).status, 200, 'other routes are untouched');
});

test('a system API row cannot be renamed, deleted or re-scoped through Master Settings, even by Super Admin', async function(t) {
  if (skip) return t.skip(skip);
  var row = await knex('apis').where({ name: '/auth/api/admin/master/roles/delete' }).first();
  var rename = await call('POST', '/auth/api/admin/master/apis', { id: row.id, name: '/somewhere/else' }, SA);
  assert.equal(rename.status, 400);
  var del = await call('POST', '/auth/api/admin/master/apis/delete', { id: row.id }, SA);
  assert.equal(del.status, 400);
  var company = await knex('apis').where({ name: '/auth/api/admin/users' }).first();
  var rescope = await call('POST', '/auth/api/admin/master/apis', { id: company.id, name: company.name, scope: 'system' }, SA);
  assert.equal(rescope.status, 200);
  assert.equal((await knex('apis').where({ id: company.id }).first()).scope, 'company', 'scope is not an editable field');
  var still = await knex('apis').where({ id: row.id }).first();
  assert.deepEqual([still.name, still.scope], ['/auth/api/admin/master/roles/delete', 'system']);
});

test("Super Admin's switch: an API becomes Super Admin only at once, and back", async function(t) {
  if (skip) return t.skip(skip);
  await knex('apis').insert({ id: 'papi00000000000000000002', name: '/api/reports', apiGroup: 'reports:view', isActive: true });
  store.clear();
  assert.equal((await call('GET', '/api/reports', null, CA)).status, 200);

  var on = await call('POST', '/auth/api/admin/master/apis/scope', { id: 'papi00000000000000000002', scope: 'system' }, SA);
  assert.equal(on.status, 200);
  assert.equal((await call('GET', '/api/reports', null, CA)).status, 403, 'effective at once');
  assert.equal((await call('GET', '/api/reports', null, SA)).status, 200);

  var off = await call('POST', '/auth/api/admin/master/apis/scope', { id: 'papi00000000000000000002', scope: 'company' }, SA);
  assert.equal(off.status, 200);
  assert.equal((await call('GET', '/api/reports', null, CA)).status, 200);
});

test('the switch is Super Admin only, and a locked API cannot be switched off', async function(t) {
  if (skip) return t.skip(skip);
  var any = await knex('apis').where({ name: '/auth/api/admin/users' }).first();
  assert.equal((await call('POST', '/auth/api/admin/master/apis/scope', { id: any.id, scope: 'system' }, CA)).status, 403);
  var locked = await knex('apis').where({ name: '/auth/api/admin/master/roles/delete' }).first();
  assert.equal(locked.scopeLocked, true);
  var res = await call('POST', '/auth/api/admin/master/apis/scope', { id: locked.id, scope: 'company' }, SA);
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'SCOPE_LOCKED');
  assert.equal((await knex('apis').where({ id: locked.id }).first()).scope, 'system');
  var self = await knex('apis').where({ name: '/auth/api/admin/master/apis/scope' }).first();
  assert.equal(self.scopeLocked, true, 'the switch cannot switch itself off');
});

test('Master Settings lists each API with its scope and lock', async function(t) {
  if (skip) return t.skip(skip);
  var list = await call('GET', '/auth/api/admin/master/apis', null, SA);
  var del = list.body.find(function(a) { return a.name === '/auth/api/admin/master/roles/delete'; });
  assert.deepEqual([del.scope, del.scopeLocked], ['system', true]);
});

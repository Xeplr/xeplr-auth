// Roles belong to the company they are created in; generic ('*') roles are
// everyone's; Super Admin copies roles between companies. Real Postgres and a
// stand-in for the token check, as in systemScope.test.js.
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
utils.cache.delPattern = async function() { store.clear(); };

// These users exist only in a header, with no role mappings in the database,
// so the catalog check on admin routes is let through here: this suite is
// about scope, not access. accessGate is tested in authRoutesAccess.test.js.
require('../lib/accessService').requestApiState = async function() { return { api: null, state: 'enabled' }; };

require.cache[require.resolve('../lib/authMiddleware')] = {
  id: 'authMiddleware', loaded: true,
  exports: function(req, res, next) { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }
};

var { BaseModel } = require('@xeplr/db');
var tenant = require('../lib/tenant');

var DB = 'xeplr_auth_tenant_' + process.pid;
var admin, knex, server, base, skip = null;
var SA = ['Super Admin'];

async function call(method, url, body, company, roles) {
  var headers = { 'x-test-user': JSON.stringify({ id: 'u1', roles: roles || SA }) };
  if (company) headers['x-company-id'] = company;
  if (body) headers['content-type'] = 'application/json';
  var res = await fetch(base + url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
var R = '/auth/api/admin/master/roles';

before(async function() {
  admin = knexLib({ client: 'pg', connection: { database: 'postgres' } });
  try { await admin.raw('SELECT 1'); } catch (err) { skip = 'no Postgres available (' + err.message + ')'; return; }
  await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  await admin.raw('CREATE DATABASE ??', [DB]);
  knex = knexLib({ client: 'pg', connection: { database: DB } });
  // A role made before roles had a company: no mtId1. 0010 must keep it visible.
  for (var f of ['0001_extensions.sql', '0002_users.sql', '0003_catalog_tables.sql', '0004_role_mappings.sql',
                 '0006_seed_catalog.sql', '0007_license_module.sql']) {
    await knex.raw(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  }
  await knex('roles').insert({ id: 'rold00000000000000000001', name: 'Old Role', isActive: true });
  await knex.raw(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0010_system_scope.sql'), 'utf8'));
  BaseModel.knex(knex);
  var app = express();
  app.use(express.json());
  app.use('/auth/api/admin', require('../lib/adminRouter')());
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

test('AUTH_TENANT_HEADER: a header name, or none; unset is refused', function() {
  assert.equal(tenant.tenantHeader({ AUTH_TENANT_HEADER: 'X-Company-Id' }), 'x-company-id');
  assert.equal(tenant.tenantHeader({ AUTH_TENANT_HEADER: 'none' }), null);
  assert.throws(function() { tenant.tenantHeader({}); }, /AUTH_TENANT_HEADER/);
  assert.deepEqual(tenant.tenantOf({ headers: { 'x-company-id': 'c1' } }, { AUTH_TENANT_HEADER: 'x-company-id' }), { multiTenant: true, companyId: 'c1' });
  assert.deepEqual(tenant.tenantOf({ headers: {} }, { AUTH_TENANT_HEADER: 'none' }), { multiTenant: false, companyId: null });
});

test('a role made before companies existed stays generic and visible', async function(t) {
  if (skip) return t.skip(skip);
  assert.equal((await knex('roles').where({ id: 'rold00000000000000000001' }).first()).mtId1, '*');
  var list = await call('GET', R, null, 'c1');
  assert.ok(list.body.some(function(r) { return r.name === 'Old Role'; }));
});

test('a new role belongs to the company it is created in, even by Super Admin', async function(t) {
  if (skip) return t.skip(skip);
  var made = await call('POST', R, { name: 'Regional Manager' }, 'c1');
  assert.equal(made.status, 200);
  assert.equal((await knex('roles').where({ id: made.body.id }).first()).mtId1, 'c1');
  var inC1 = await call('GET', R, null, 'c1');
  var inC2 = await call('GET', R, null, 'c2');
  assert.ok(inC1.body.some(function(r) { return r.name === 'Regional Manager'; }));
  assert.equal(inC2.body.some(function(r) { return r.name === 'Regional Manager'; }), false, 'another company does not see it');
  assert.ok(inC2.body.some(function(r) { return r.name === 'Old Role'; }), 'generic roles are everyone\'s');
});

test('creating a company role with no company selected is refused', async function(t) {
  if (skip) return t.skip(skip);
  var res = await call('POST', R, { name: 'Nowhere' }, null);
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'NO_COMPANY');
  assert.equal(await knex('roles').where({ name: 'Nowhere' }).first(), undefined);
});

test('a system role is generic, wherever it is created from', async function(t) {
  if (skip) return t.skip(skip);
  var res = await call('POST', R, { name: 'Licence Manager', scope: 'system' }, 'c1');
  assert.equal(res.status, 200);
  assert.equal((await knex('roles').where({ id: res.body.id }).first()).mtId1, '*');
});

test('a name is unique within a company, not across companies', async function(t) {
  if (skip) return t.skip(skip);
  assert.equal((await call('POST', R, { name: 'regional manager' }, 'c1')).status, 409);
  assert.equal((await call('POST', R, { name: 'Regional Manager' }, 'c2')).status, 200);
});

test("another company's role cannot be renamed or deleted from here", async function(t) {
  if (skip) return t.skip(skip);
  var c1role = (await knex('roles').where({ name: 'Regional Manager', mtId1: 'c1' }).first()).id;
  assert.equal((await call('POST', R, { id: c1role, name: 'Hijacked' }, 'c2')).status, 404);
  assert.equal((await call('POST', R + '/delete', { id: c1role }, 'c2')).status, 404);
  assert.equal((await knex('roles').where({ id: c1role }).first()).name, 'Regional Manager');
});

test('copy to companies: independent copies with the same grants; existing names skipped', async function(t) {
  if (skip) return t.skip(skip);
  var made = await call('POST', R, { name: 'Analyst' }, 'c1');
  var api = await knex('apis').where({ name: '/auth/api/admin/users' }).first();
  var menu = { id: 'm00000000000000000000001', name: 'Reports', isActive: true };
  await knex('menus').insert(menu);
  await knex('apisRolesMapping').insert({ id: 'g1', roleId: made.body.id, apiId: api.id, isActive: true });
  await knex('menuRolesMapping').insert({ id: 'g2', roleId: made.body.id, menuId: menu.id, isActive: true });
  await call('POST', R, { name: 'Analyst' }, 'c3');   // c3 already has one

  var res = await call('POST', R + '/copy', { roleIds: [made.body.id], companyIds: ['c2', 'c3', 'c4'] }, 'c1');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.copied.map(function(c) { return c.companyId; }), ['c2', 'c4']);
  assert.deepEqual(res.body.skipped.map(function(s) { return s.companyId; }), ['c3']);

  var copy = await knex('roles').where({ name: 'Analyst', mtId1: 'c2' }).first();
  assert.notEqual(copy.id, made.body.id, 'a copy, not the same role');
  assert.equal((await knex('apisRolesMapping').where({ roleId: copy.id, apiId: api.id }).first()).isActive, true);
  assert.ok(await knex('menuRolesMapping').where({ roleId: copy.id, menuId: menu.id }).first(), 'menus copied too');

  // Independent: removing a grant from the copy leaves the original alone.
  await knex('apisRolesMapping').where({ roleId: copy.id }).del();
  assert.ok(await knex('apisRolesMapping').where({ roleId: made.body.id }).first());
});

test('copying is Super Admin only, and system roles are not copied', async function(t) {
  if (skip) return t.skip(skip);
  var any = (await knex('roles').where({ mtId1: 'c1' }).first()).id;
  assert.equal((await call('POST', R + '/copy', { roleIds: [any], companyIds: ['c9'] }, 'c1', ['CompanyAdmin'])).status, 403);
  var sa = (await knex('roles').where({ name: 'Super Admin' }).first()).id;
  var res = await call('POST', R + '/copy', { roleIds: [sa], companyIds: ['c9'] }, 'c1');
  assert.equal(res.body.copied.length, 0);
  assert.match(res.body.skipped[0].reason, /system role/);
});

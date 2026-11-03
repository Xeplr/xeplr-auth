// A ROLE HELD IN A COMPANY OR WORKSPACE — the roleId on the user's own
// membership row (userTenantsMapping) — counts when a request names that
// company or workspace, and nowhere else. Whoever creates a company is its
// CompanyAdmin this way while their own role stays Viewer: /verify lets them
// import in their company, and refuses it in another.
// Real Postgres (auth's own migrations, real memberships and catalog rows) and
// real Redis (the access cache). The token check itself is signUpFlow's; here
// the signed-in user is set directly, so the subject is the access answer.
var { test, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var http = require('node:http');
var express = require('express');
var knexLib = require('knex');

process.env.REDIS_PREFIX = 'xeplr_test_scopedroles_' + process.pid + ':';
var utils = require('@xeplr/utils');
var { BaseModel } = require('@xeplr/db');

var DB = 'xeplr_auth_scopedroles_' + process.pid;
var admin, knex, server, base, skip = null;
var ids = {};

async function roleNamed(name) {
  var row = await knex('roles').where({ name: name }).first();
  if (row) return row.id;
  var id = ('r' + name.replace(/\W/g, '') + '0000000000000000000000').slice(0, 25);
  await knex('roles').insert({ id: id, name: name, isActive: true, mtId1: '*' });
  return id;
}

async function apiFor(name, roleId, key) {
  var id = ('a' + key + '000000000000000000000000').slice(0, 25);
  await knex('apis').insert({ id: id, name: name, apiGroup: key + ':x', isPublic: false, isActive: true, mtId1: '*' });
  await knex('apisRolesMapping').insert({ id: ('m' + key + '000000000000000000000000').slice(0, 25), roleId: roleId, apiId: id, isActive: true, mtId1: '*' });
}

before(async function() {
  admin = knexLib({ client: 'pg', connection: { database: 'postgres' } });
  try { await admin.raw('SELECT 1'); } catch (err) { skip = 'no Postgres available (' + err.message + ')'; return; }
  try { await utils.cache.getClient().ping(); } catch (err) { skip = 'no Redis available (' + err.message + ')'; return; }
  await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  await admin.raw('CREATE DATABASE ??', [DB]);
  knex = knexLib({ client: 'pg', connection: { database: DB } });
  var dir = path.join(__dirname, '..', 'migrations');
  var files = fs.readdirSync(dir).filter(function(f) { return /\.sql$/.test(f) && f !== '0008_super_admin.sql'; }).sort();
  for (var f of files) await knex.raw(fs.readFileSync(path.join(dir, f), 'utf8'));
  BaseModel.knex(knex);

  ids.viewer = await roleNamed('Viewer');
  ids.companyAdmin = await roleNamed('CompanyAdmin');
  ids.creator = await roleNamed('Creator');
  // Importing is the company admin's; saving a report the workspace's Creator's.
  await apiFor('GET /imports/targets', ids.companyAdmin, 'imports');
  await apiFor('POST /reports/save', ids.creator, 'reports');
  await knex('menus').insert({ id: 'menuupload000000000000001', name: 'Upload Data', menuGroup: 'imports:x', isPublic: false, isActive: true, mtId1: '*' });
  await knex('menuRolesMapping').insert({ id: 'mnuupload0000000000000001', roleId: ids.companyAdmin, menuId: 'menuupload000000000000001', isActive: true, mtId1: '*' });

  // u1 registered as a Viewer and created company "own"; also a plain member of "theirs".
  await knex('users').insert({ id: 'u1', email: 'u1@acme.test', isActive: true });
  await knex('userRolesMapping').insert({ id: 'urm1', userId: 'u1', roleId: ids.viewer, isActive: true, mtId1: '*' });
  await knex('userTenantsMapping').insert([
    { id: 't1', userId: 'u1', level: 'l1', value: 'own', roleId: ids.companyAdmin, isActive: true },
    { id: 't2', userId: 'u1', level: 'l2', value: 'w1', roleId: ids.creator, isActive: true },
    { id: 't3', userId: 'u1', level: 'l2', value: 'w2', roleId: null, isActive: true },
    { id: 't4', userId: 'u1', level: 'l1', value: 'theirs', roleId: null, isActive: true }
  ]);

  require.cache[require.resolve('../lib/authMiddleware')] = {
    id: 'authMiddleware', loaded: true,
    exports: function(req, res, next) { req.user = { id: 'u1', roles: ['Viewer'] }; next(); }
  };
  var app = express();
  app.use('/auth/api', require('../lib/authRouter')());
  server = http.createServer(app);
  await new Promise(function(r) { server.listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port + '/auth/api';
});

after(async function() {
  if (server) server.close();
  if (!skip) await utils.cache.delPattern('*');
  try { utils.cache.getClient().disconnect(); } catch (e) {}
  if (knex) await knex.destroy();
  if (admin && !skip) await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  if (admin) await admin.destroy();
});

async function verify(method, apiPath, tenant) {
  var headers = { 'x-verify-method': method, 'x-verify-path': apiPath };
  if (tenant) headers['x-verify-tenant'] = JSON.stringify(tenant);
  var res = await fetch(base + '/verify', { headers: headers });
  return { status: res.status, body: await res.json() };
}

async function me(tenant) {
  var res = await fetch(base + '/me', { headers: tenant ? { 'x-verify-tenant': JSON.stringify(tenant) } : {} });
  return { status: res.status, body: await res.json() };
}

test('the company you created: you are its admin there, and only there', async function(t) {
  if (skip) return t.skip(skip);
  var own = await verify('GET', '/imports/targets', { l1: 'own' });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.ok(own.body.access.roles.includes('CompanyAdmin'), 'the answer says so');

  var nowhere = await verify('GET', '/imports/targets');
  assert.equal(nowhere.status, 403, 'naming no company, a Viewer is a Viewer');
  assert.equal(nowhere.body.code, 'HIDDEN');

  var theirs = await verify('GET', '/imports/targets', { l1: 'theirs' });
  assert.equal(theirs.status, 403, 'a member of another company without a role there');
  assert.equal(theirs.body.code, 'HIDDEN');

  var stranger = await verify('GET', '/imports/targets', { l1: 'nobodys' });
  assert.equal(stranger.status, 403, 'naming a company gives no role: not a member at all');
  assert.equal(stranger.body.code, 'NOT_A_MEMBER');
});

test('a workspace role counts in that workspace; the company role in all of its workspaces', async function(t) {
  if (skip) return t.skip(skip);
  assert.equal((await verify('POST', '/reports/save', { l1: 'own', l2: 'w1' })).status, 200, 'Creator in w1');
  var w2 = await verify('POST', '/reports/save', { l1: 'own', l2: 'w2' });
  assert.equal(w2.status, 403, 'not Creator in w2');
  assert.equal(w2.body.code, 'HIDDEN');
  assert.equal((await verify('GET', '/imports/targets', { l1: 'own', l2: 'w2' })).status, 200, 'still the company admin in w2');
});

test('/me answers as the user is in the company they name', async function(t) {
  if (skip) return t.skip(skip);
  var plain = await me();
  assert.equal(plain.status, 200);
  assert.deepEqual(plain.body.access.roles, ['Viewer']);
  assert.ok(!plain.body.access.menus.includes('Upload Data'));

  var own = await me({ l1: 'own', l2: 'w1' });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.deepEqual(own.body.access.roles.slice().sort(), ['CompanyAdmin', 'Creator', 'Viewer']);
  assert.ok(own.body.access.apis.includes('GET /imports/targets'));
  assert.ok(own.body.access.menus.includes('Upload Data'), 'the menu the role brings');

  var stranger = await me({ l1: 'nobodys' });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.code, 'NOT_A_MEMBER');
  var bad = await fetch(base + '/me', { headers: { 'x-verify-tenant': 'not json' } });
  assert.equal(bad.status, 400);
});

test('a role taken away is gone once the user\'s access is cleared', async function(t) {
  if (skip) return t.skip(skip);
  var service = require('../lib/accessService');
  assert.equal((await verify('GET', '/imports/targets', { l1: 'own' })).status, 200);
  await knex('userTenantsMapping').where({ id: 't1' }).update({ roleId: null });
  await service.clearUserAccess('u1');
  var after = await verify('GET', '/imports/targets', { l1: 'own' });
  assert.equal(after.status, 403);
  assert.equal(after.body.code, 'HIDDEN');
  assert.deepEqual((await me({ l1: 'own' })).body.access.roles, ['Viewer']);
  await knex('userTenantsMapping').where({ id: 't1' }).update({ roleId: ids.companyAdmin });
  await service.clearUserAccess('u1');
});

test('an app running auth in-process reads the company from its own header', async function(t) {
  if (skip) return t.skip(skip);
  var { accessMiddleware } = require('../lib/accessMiddleware');
  var authHelper = require('../lib/authHelper');
  var token = authHelper.generateAccessToken({ id: "u1", email: "u1@acme.test", roles: ["Viewer"] });
  if (!token) return t.skip('no token helper');
  var app = express();
  app.use(accessMiddleware({ apiNameResolver: function() { return 'GET /imports/targets'; } }));
  app.use(function(req, res) { res.json({ ok: true }); });
  var s = http.createServer(app);
  await new Promise(function(r) { s.listen(0, '127.0.0.1', r); });
  var url = 'http://127.0.0.1:' + s.address().port + '/imports/targets';
  try {
    var withOwn = await fetch(url, { headers: { authorization: 'Bearer ' + token, 'x-verify-tenant': JSON.stringify({ l1: 'own' }) } });
    assert.equal(withOwn.status, 200);
    var without = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
    assert.equal(without.status, 403);
  } finally { s.close(); }
});

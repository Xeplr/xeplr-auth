// GET /verify answers membership too: a request naming a company or workspace
// the user does not belong to is refused there (403 NOT_A_MEMBER), before any
// app sees it — the check @xeplr/base-apis' gate asks on every request.
// Real Postgres (auth's own migrations, real memberships) and real Redis (the
// access cache /verify reads). The token check itself is signUpFlow's; here
// the signed-in user is set directly, so the subject is the membership answer.
var { test, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var http = require('node:http');
var express = require('express');
var knexLib = require('knex');

process.env.REDIS_PREFIX = 'xeplr_test_verifytenant_' + process.pid + ':';
var utils = require('@xeplr/utils');
var { BaseModel } = require('@xeplr/db');

var DB = 'xeplr_auth_verifytenant_' + process.pid;
var admin, knex, server, base, skip = null;
var { refusedTenant } = require('../lib/mtMembershipMiddleware');

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

  await knex('users').insert([{ id: 'u1', email: 'u1@acme.test', isActive: true }, { id: 'sa', email: 'sa@acme.test', isActive: true }]);
  await knex('userTenantsMapping').insert([
    { id: 'm1', userId: 'u1', level: 'l1', value: 'acme', isActive: true },
    { id: 'm2', userId: 'u1', level: 'l2', value: 'w1', isActive: true },
    { id: 'm3', userId: 'u1', level: 'l2', value: 'w-old', isActive: false }
  ]);

  // The signed-in user, as authMiddleware would set it from a real token.
  require.cache[require.resolve('../lib/authMiddleware')] = {
    id: 'authMiddleware', loaded: true,
    exports: function(req, res, next) {
      req.user = req.headers['x-test-user'] === 'sa' ? { id: 'sa', roles: ['Super Admin'] } : { id: 'u1', roles: ['Viewer'] };
      next();
    }
  };
  var app = express();
  app.use('/auth/api', require('../lib/authRouter')());
  server = http.createServer(app);
  await new Promise(function(r) { server.listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port + '/auth/api/verify';
});

after(async function() {
  if (server) server.close();
  if (!skip) await utils.cache.delPattern('*');
  try { utils.cache.getClient().disconnect(); } catch (e) {}
  if (knex) await knex.destroy();
  if (admin && !skip) await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  if (admin) await admin.destroy();
});

async function verify(tenant, user) {
  var headers = { 'x-verify-method': 'GET', 'x-verify-path': '/reports/r1', 'x-test-user': user || 'u1' };
  if (tenant !== undefined) headers['x-verify-tenant'] = typeof tenant === 'string' ? tenant : JSON.stringify(tenant);
  var res = await fetch(base, { headers: headers });
  return { status: res.status, body: await res.json() };
}

test('the one membership check, on real memberships', async function(t) {
  if (skip) return t.skip(skip);
  var u1 = { id: 'u1', roles: ['Viewer'] };
  assert.equal(await refusedTenant(u1, { l1: 'acme', l2: 'w1' }), null, 'a member of both');
  assert.deepEqual(await refusedTenant(u1, { l1: 'beta' }), { level: 'l1', value: 'beta' }, 'another company');
  assert.deepEqual(await refusedTenant(u1, { l1: 'acme', l2: 'w2' }), { level: 'l2', value: 'w2' }, 'another workspace');
  assert.deepEqual(await refusedTenant(u1, { l1: 'acme', l2: 'w-old' }), { level: 'l2', value: 'w-old' }, 'a membership switched off');
  assert.equal(await refusedTenant(u1, { l1: 'acme', l2: '' }), null, 'a level not named is not asked');
  assert.equal(await refusedTenant({ id: 'sa', roles: ['Super Admin'] }, { l1: 'beta', l2: 'w9' }), null, 'Super Admin belongs to every one');
});

test('/verify refuses a company or workspace the user does not belong to', async function(t) {
  if (skip) return t.skip(skip);
  var ok = await verify({ l1: 'acme', l2: 'w1' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.tenant, 'checked', 'and says it checked');

  var other = await verify({ l1: 'beta', l2: 'w1' });
  assert.equal(other.status, 403);
  assert.equal(other.body.code, 'NOT_A_MEMBER');
  assert.match(other.body.error, /l1 "beta"/);

  var ws = await verify({ l1: 'acme', l2: 'w2' });
  assert.equal(ws.status, 403);
  assert.equal(ws.body.code, 'NOT_A_MEMBER');

  var sa = await verify({ l1: 'beta', l2: 'w9' }, 'sa');
  assert.equal(sa.status, 200);
  assert.equal(sa.body.tenant, 'checked');

  var none = await verify(undefined);
  assert.equal(none.status, 200);
  assert.equal(none.body.tenant, undefined, 'nothing named, nothing checked — and it does not claim to');
});

test('/verify refuses a tenant it cannot read, rather than passing it', async function(t) {
  if (skip) return t.skip(skip);
  for (var bad of ['not json', '[]', '{}', JSON.stringify({ company: 'acme' }), JSON.stringify({ l1: 7 }), JSON.stringify({ l1: '' }), JSON.stringify({ l5: 'x' })]) {
    var r = await verify(bad);
    assert.equal(r.status, 400, bad);
    assert.equal(r.body.code, 'BAD_TENANT', bad);
  }
});

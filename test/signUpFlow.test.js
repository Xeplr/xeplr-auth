// The whole sign-up flow over HTTP: register → activation mail → activate →
// login → /me, plus resend, admin activate, forgot/reset and the refusals.
// Real Postgres (auth's own migrations), real Redis, the real token check,
// and real mail: nodemailer talks SMTP to a small listener in this file.
var { test, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var http = require('node:http');
var net = require('node:net');
var express = require('express');
var knexLib = require('knex');

process.env.AUTH_TENANT_HEADER = 'none';
process.env.REDIS_PREFIX = 'xeplr_test_signup_' + process.pid + ':';
process.env.AUTH_ACTIVATION_URL = 'http://app.test/auth/activate';
process.env.AUTH_RESET_URL = 'http://app.test/auth/reset-password';
process.env.AUTH_REGISTER_ROLES = 'Viewer';

var utils = require('@xeplr/utils');
var { BaseModel } = require('@xeplr/db');
var authService = require('../lib/authService');
var { formatDbDateTime } = utils;

var DB = 'xeplr_auth_signup_' + process.pid;
var admin, knex, server, base, smtp, skip = null;

// ── A minimal SMTP listener: records each message, or refuses recipients ──
var inbox = [];
var refuseMail = false;

function startSmtp() {
  return new Promise(function(resolve) {
    var srv = net.createServer(function(sock) {
      var data = null;
      var buffer = '';
      sock.write('220 test ESMTP\r\n');
      sock.on('data', function(chunk) {
        buffer += chunk.toString('utf8');
        var i;
        while ((i = buffer.indexOf('\r\n')) !== -1) {
          var line = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          if (data !== null) {
            if (line === '.') { inbox.push(data.join('\n')); data = null; sock.write('250 queued\r\n'); }
            else data.push(line.charAt(0) === '.' ? line.slice(1) : line);
            continue;
          }
          var verb = line.slice(0, 4).toUpperCase();
          if (verb === 'EHLO' || verb === 'HELO') sock.write('250 test\r\n');
          else if (verb === 'MAIL') sock.write('250 ok\r\n');
          else if (verb === 'RCPT') sock.write(refuseMail ? '550 mailbox unavailable\r\n' : '250 ok\r\n');
          else if (verb === 'DATA') { data = []; sock.write('354 go ahead\r\n'); }
          else if (verb === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
          else sock.write('250 ok\r\n');
        }
      });
    });
    srv.listen(0, '127.0.0.1', function() { resolve(srv); });
  });
}

// Mail bodies are quoted-printable; undo it to read the link back.
function decodeQP(s) {
  return s.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, function(m, h) { return String.fromCharCode(parseInt(h, 16)); });
}

function lastLink() {
  var body = decodeQP(inbox[inbox.length - 1] || '');
  var m = /href="([^"]+)"/.exec(body);
  return m ? m[1] : null;
}

function tokenOf(link) { return new URL(link).searchParams.get('token'); }

async function call(method, url, body, headers) {
  var res = await fetch(base + url, {
    method: method,
    headers: Object.assign(body ? { 'content-type': 'application/json' } : {}, headers || {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, body: json };
}

function bearer(token) { return { authorization: 'Bearer ' + token }; }

async function userCount(email) {
  return Number((await knex('users').where({ email: email }).count('* as n'))[0].n);
}

async function signInAs(roleName) {
  var email = roleName.toLowerCase().replace(/\s/g, '') + '@signup.test';
  var res = await call('POST', '/auth/api/register', { email: email, password: 'pw-' + roleName });
  assert.equal(res.status, 201);
  await call('GET', '/auth/api/activate?token=' + tokenOf(lastLink()));
  if (roleName !== 'Viewer') {
    var role = await knex('roles').where({ name: roleName }).first();
    await knex('userRolesMapping').insert({ id: 'm' + roleName.replace(/\s/g, ''), userId: res.body.user.id, roleId: role.id, isActive: true, mtId1: '*' });
    await utils.cache.delPattern('*');
  }
  var login = await call('POST', '/auth/api/login', { email: email, password: 'pw-' + roleName });
  assert.equal(login.status, 200);
  return login.body.accessToken;
}

before(async function() {
  admin = knexLib({ client: 'pg', connection: { database: 'postgres' } });
  try { await admin.raw('SELECT 1'); } catch (err) { skip = 'no Postgres available (' + err.message + ')'; return; }
  try { await utils.cache.getClient().ping(); } catch (err) { skip = 'no Redis available (' + err.message + ')'; return; }
  try { require.resolve('nodemailer'); } catch (err) { skip = 'nodemailer is not installed'; return; }

  await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  await admin.raw('CREATE DATABASE ??', [DB]);
  knex = knexLib({ client: 'pg', connection: { database: DB } });
  var dir = path.join(__dirname, '..', 'migrations');
  var files = fs.readdirSync(dir).filter(function(f) { return /\.sql$/.test(f) && f !== '0008_super_admin.sql'; }).sort();
  for (var f of files) await knex.raw(fs.readFileSync(path.join(dir, f), 'utf8'));
  BaseModel.knex(knex);

  smtp = await startSmtp();
  utils.configureEmail({
    provider: 'smtp',
    smtp: { host: '127.0.0.1', port: smtp.address().port, from: 'auth@app.test', secure: false, ignoreTLS: true }
  });

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
  if (smtp) smtp.close();
  if (!skip) await utils.cache.delPattern('*');
  try { utils.cache.getClient().disconnect(); } catch (e) {}
  if (knex) await knex.destroy();
  if (admin && !skip) await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  if (admin) await admin.destroy();
});

// ── Registration refuses before an account exists ──────────────────────────

test('register refuses while AUTH_REGISTER_ROLES is unset, and leaves no account', async function(t) {
  if (skip) return t.skip(skip);
  delete process.env.AUTH_REGISTER_ROLES;
  try {
    var r = await call('POST', '/auth/api/register', { email: 'noroles@signup.test', password: 'pw' });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'REGISTER_ROLES_NOT_SET');
    assert.match(r.body.error, /AUTH_REGISTER_ROLES/);
    assert.equal(await userCount('noroles@signup.test'), 0);
  } finally {
    process.env.AUTH_REGISTER_ROLES = 'Viewer';
  }
});

test('register refuses a sign-up role that does not exist, or is a system role', async function(t) {
  if (skip) return t.skip(skip);
  try {
    process.env.AUTH_REGISTER_ROLES = 'Viewer, Nobody';
    var r = await call('POST', '/auth/api/register', { email: 'badrole@signup.test', password: 'pw' });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'REGISTER_ROLES_UNKNOWN');
    assert.match(r.body.error, /Nobody/);

    process.env.AUTH_REGISTER_ROLES = 'Super Admin';
    r = await call('POST', '/auth/api/register', { email: 'badrole@signup.test', password: 'pw' });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'REGISTER_ROLES_SYSTEM');
    assert.equal(await userCount('badrole@signup.test'), 0);
  } finally {
    process.env.AUTH_REGISTER_ROLES = 'Viewer';
  }
});

test('register refuses up front when email is known not to work', async function(t) {
  if (skip) return t.skip(skip);
  authService.configureEmailStatus(false);
  try {
    var r = await call('POST', '/auth/api/register', { email: 'nomail@signup.test', password: 'pw' });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'EMAIL_NOT_SET_UP');
    assert.equal(await userCount('nomail@signup.test'), 0);
  } finally {
    authService.configureEmailStatus(null);
  }
});

test('a failed send rolls the account back, so trying again works', async function(t) {
  if (skip) return t.skip(skip);
  refuseMail = true;
  try {
    var r = await call('POST', '/auth/api/register', { email: 'retry@signup.test', password: 'pw' });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'EMAIL_SEND_FAILED');
    assert.equal(await userCount('retry@signup.test'), 0);
  } finally {
    refuseMail = false;
  }
  var again = await call('POST', '/auth/api/register', { email: 'retry@signup.test', password: 'pw' });
  assert.equal(again.status, 201);
});

// ── The happy path ─────────────────────────────────────────────────────────

test('register → mail → login refused → activate → Viewer role → login → /me', async function(t) {
  if (skip) return t.skip(skip);
  var sent = inbox.length;
  var r = await call('POST', '/auth/api/register', { email: 'happy@signup.test', password: 'secret1', name: 'Hap' });
  assert.equal(r.status, 201);
  assert.equal(inbox.length, sent + 1, 'one activation mail');
  var link = lastLink();
  assert.ok(link.indexOf('http://app.test/auth/activate?token=') === 0, link);

  var early = await call('POST', '/auth/api/login', { email: 'happy@signup.test', password: 'secret1' });
  assert.equal(early.status, 403);
  assert.equal(early.body.code, 'NOT_ACTIVATED');

  var act = await call('GET', '/auth/api/activate?token=' + tokenOf(link));
  assert.equal(act.status, 200);
  var roles = await knex('userRolesMapping as m').join('roles as r', 'r.id', 'm.roleId')
    .where('m.userId', r.body.user.id).pluck('r.name');
  assert.deepEqual(roles, ['Viewer']);

  var login = await call('POST', '/auth/api/login', { email: 'happy@signup.test', password: 'secret1' });
  assert.equal(login.status, 200);
  var me = await call('GET', '/auth/api/me', null, bearer(login.body.accessToken));
  assert.equal(me.status, 200, 'a new sign-up can open its own account');
  assert.equal(me.body.user.email, 'happy@signup.test');

  var reused = await call('GET', '/auth/api/activate?token=' + tokenOf(link));
  assert.equal(reused.status, 400, 'the link works once');
});

// ── Resend ─────────────────────────────────────────────────────────────────

test('resend-activation answers alike for any address and replaces the old link', async function(t) {
  if (skip) return t.skip(skip);
  await call('POST', '/auth/api/register', { email: 'resend@signup.test', password: 'pw' });
  var oldToken = tokenOf(lastLink());
  var sent = inbox.length;

  var unknown = await call('POST', '/auth/api/resend-activation', { email: 'nobody@signup.test' });
  var known = await call('POST', '/auth/api/resend-activation', { email: 'resend@signup.test' });
  assert.equal(unknown.status, 200);
  assert.deepEqual(known.body, unknown.body);
  assert.equal(inbox.length, sent + 1, 'only the real account gets a mail');

  var newToken = tokenOf(lastLink());
  assert.notEqual(newToken, oldToken);
  var stale = await call('GET', '/auth/api/activate?token=' + oldToken);
  assert.equal(stale.status, 400);
  assert.equal(stale.body.error, 'Invalid activation token');
  assert.equal((await call('GET', '/auth/api/activate?token=' + newToken)).status, 200);
});

// ── Admin activate ─────────────────────────────────────────────────────────

test('an Admin activates an account by hand; a Viewer cannot', async function(t) {
  if (skip) return t.skip(skip);
  var reg = await call('POST', '/auth/api/register', { email: 'manual@signup.test', password: 'pw' });
  var id = reg.body.user.id;
  var adminToken = await signInAs('Admin');
  var viewerToken = await signInAs('Viewer');

  var refused = await call('POST', '/auth/api/admin/users/' + id + '/activate', null, bearer(viewerToken));
  assert.equal(refused.status, 403);

  var ok = await call('POST', '/auth/api/admin/users/' + id + '/activate', null, bearer(adminToken));
  assert.equal(ok.status, 200);
  var row = await knex('users').where({ id: id }).first();
  assert.equal(row.isActivated, true);
  assert.equal(row.activationToken, null);
  var roles = await knex('userRolesMapping as m').join('roles as r', 'r.id', 'm.roleId').where('m.userId', id).pluck('r.name');
  assert.deepEqual(roles, ['Viewer']);

  var twice = await call('POST', '/auth/api/admin/users/' + id + '/activate', null, bearer(adminToken));
  assert.equal(twice.status, 409);
});

// ── Invites ────────────────────────────────────────────────────────────────

test('an invite token is refused on /activate, and an invited account cannot log in yet', async function(t) {
  if (skip) return t.skip(skip);
  process.env.AUTH_INVITE_URL = 'http://app.test/auth/accept-invite';
  await authService.invite({ email: 'invited@signup.test', name: 'Inv' });
  var token = tokenOf(lastLink());

  var r = await call('GET', '/auth/api/activate?token=' + token);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /invitation/);
  assert.equal((await call('GET', '/auth/api/invite-preview?token=' + token)).status, 200, 'the invite still works');

  var login = await call('POST', '/auth/api/login', { email: 'invited@signup.test', password: 'anything' });
  assert.equal(login.status, 401);
});

// ── Forgot / reset ─────────────────────────────────────────────────────────

test('the reset link uses AUTH_RESET_URL, never the request Host header', async function(t) {
  if (skip) return t.skip(skip);
  var r = await call('POST', '/auth/api/forgot-password', { email: 'happy@signup.test' }, { 'x-forwarded-host': 'evil.test' });
  assert.equal(r.status, 200);
  assert.ok(lastLink().indexOf('http://app.test/auth/reset-password?token=') === 0, lastLink());
});

test('forgot-password refuses without AUTH_RESET_URL, for every address alike', async function(t) {
  if (skip) return t.skip(skip);
  var saved = process.env.AUTH_RESET_URL;
  delete process.env.AUTH_RESET_URL;
  try {
    var known = await call('POST', '/auth/api/forgot-password', { email: 'happy@signup.test' });
    var unknown = await call('POST', '/auth/api/forgot-password', { email: 'nobody@signup.test' });
    assert.equal(known.status, 503);
    assert.equal(known.body.code, 'RESET_URL_NOT_SET');
    assert.deepEqual(known.body, unknown.body);
  } finally {
    process.env.AUTH_RESET_URL = saved;
  }
});

test('a fresh reset link works as sent, whatever the server time zone', async function(t) {
  if (skip) return t.skip(skip);
  await call('POST', '/auth/api/forgot-password', { email: 'happy@signup.test' });
  var r = await call('POST', '/auth/api/reset-password', { token: tokenOf(lastLink()), newPassword: 'secret1b' });
  assert.equal(r.status, 200, 'a link straight from the mail is not expired');
});

test('an expired reset link is refused; a fresh one resets the password', async function(t) {
  if (skip) return t.skip(skip);
  await call('POST', '/auth/api/forgot-password', { email: 'happy@signup.test' });
  var token = tokenOf(lastLink());

  // Written the way forgotPassword writes it (UTC, formatDbDateTime), and the
  // fresh link is checked untouched first: a Date written by the driver is
  // local time and once hid a time-zone bug that refused every fresh link.
  await knex('users').where({ resetToken: token }).update({ resetTokenExpiry: formatDbDateTime(new Date(Date.now() - 60 * 1000)) });
  var expired = await call('POST', '/auth/api/reset-password', { token: token, newPassword: 'secret2' });
  assert.equal(expired.status, 400);

  await knex('users').where({ resetToken: token }).update({ resetTokenExpiry: formatDbDateTime(new Date(Date.now() + 10 * 60 * 1000)) });
  var fresh = await call('POST', '/auth/api/reset-password', { token: token, newPassword: 'secret2' });
  assert.equal(fresh.status, 200);
  assert.equal((await call('POST', '/auth/api/login', { email: 'happy@signup.test', password: 'secret2' })).status, 200);
});

// ── Catalog ────────────────────────────────────────────────────────────────

test('0014 registers the new routes once; sse-ticket is no longer open to anyone', async function(t) {
  if (skip) return t.skip(skip);
  var count = async function() { return Number((await knex('apis').count('* as n'))[0].n); };
  var beforeCount = await count();
  await knex.raw(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0014_activation_routes.sql'), 'utf8'));
  assert.equal(await count(), beforeCount, 're-running adds nothing');

  var noUser = await call('POST', '/auth/api/sse-ticket');
  assert.equal(noUser.status, 401);
});

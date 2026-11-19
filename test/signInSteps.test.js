// Signing in with a code (email, mobile) and the second step (authenticator,
// email, text), over HTTP. Real Postgres (auth's own migrations), real Redis,
// the real token check, real mail (an SMTP listener) and a real SMS provider
// call (@xeplr/utils sms, posting to an HTTP listener in this file).
var { test, before, after, beforeEach } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var http = require('node:http');
var express = require('express');
var knexLib = require('knex');

process.env.AUTH_TENANT_HEADER = 'none';
process.env.REDIS_PREFIX = 'xeplr_test_signin_' + process.pid + ':';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-' + process.pid;

var utils = require('@xeplr/utils');
var { BaseModel } = require('@xeplr/db');
var { hashPassword, generateId } = require('../lib/authHelper');
var signInSteps = require('../lib/signInSteps');
var { startMailbox, decodeQP } = require('./support/mailbox');

var DB = 'xeplr_auth_signin_' + process.pid;
var admin, knex, server, base, mailbox, smsServer, skip = null;
var texts = [];

var SETTINGS = ['AUTH_LOGIN_METHODS', 'AUTH_2FA', 'AUTH_2FA_METHODS', 'AUTH_2FA_TRUST_DAYS'];
function setSettings(values) {
  SETTINGS.forEach(function(k) { delete process.env[k]; });
  Object.keys(values || {}).forEach(function(k) { process.env[k] = values[k]; });
}

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

/** The six digits in the last mail to `to`. */
function lastMailedCode(to) {
  for (var i = mailbox.messages.length - 1; i >= 0; i--) {
    var m = decodeQP(mailbox.messages[i]);
    if (m.indexOf(to) === -1) continue;
    var found = /Your sign-in code: (\d{6})/.exec(m);
    if (found) return found[1];
  }
  return null;
}

function lastText(to) {
  for (var i = texts.length - 1; i >= 0; i--) {
    if (texts[i].to === to) return /(\d{6})/.exec(texts[i].message)[1];
  }
  return null;
}

var n = 0;
async function person(opts) {
  n += 1;
  var id = generateId();
  var email = (opts && opts.email) || 'p' + n + '@signin.test';
  var pw = await hashPassword('pw-' + n);
  await knex('users').insert({
    id: id, email: email, normalizedEmail: email, pwd: pw.hash, pwdSalt: pw.salt,
    isActive: true, isActivated: true, name: 'Person ' + n,
    phoneNumber: (opts && opts.phone) || null, phoneVerified: Boolean(opts && opts.phoneVerified)
  });
  var role = await knex('roles').where({ name: (opts && opts.role) || 'Viewer' }).first();
  await knex('userRolesMapping').insert({ id: 'm' + id, userId: id, roleId: role.id, isActive: true, mtId1: '*' });
  return { id: id, email: email, password: 'pw-' + n };
}

function login(p, extra) {
  return call('POST', '/auth/api/login', Object.assign({ email: p.email, password: p.password }, extra || {}));
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

  mailbox = await startMailbox();
  utils.configureEmail({
    provider: 'smtp',
    smtp: { host: '127.0.0.1', port: mailbox.port, from: 'auth@app.test', secure: false, ignoreTLS: true }
  });

  // The SMS provider's API: records each message it is asked to send.
  smsServer = http.createServer(function(req, res) {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      texts.push(JSON.parse(body));
      res.setHeader('content-type', 'application/json');
      res.end('{"status":"queued"}');
    });
  });
  await new Promise(function(r) { smsServer.listen(0, '127.0.0.1', r); });

  var app = express();
  app.use(express.json());
  app.use('/auth/api/admin', require('../lib/adminRouter')());
  app.use('/auth/api', require('../lib/authRouter')());
  server = http.createServer(app);
  await new Promise(function(r) { server.listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});

beforeEach(function() { setSettings({}); });

after(async function() {
  setSettings({});
  if (server) server.close();
  if (smsServer) smsServer.close();
  if (mailbox) mailbox.server.close();
  if (!skip) await utils.cache.delPattern('*');
  try { utils.cache.getClient().disconnect(); } catch (e) {}
  if (knex) await knex.destroy();
  if (admin && !skip) await admin.raw('DROP DATABASE IF EXISTS ??', [DB]);
  if (admin) await admin.destroy();
});

// ── settings ───────────────────────────────────────────────────────────────

test('a text-message setting with no SMS provider stops the start, named', function(t) {
  if (skip) return t.skip(skip);
  // Before any provider is registered in this process (the phone tests below register one).
  setSettings({ AUTH_LOGIN_METHODS: 'password,phone_otp' });
  assert.throws(function() { signInSteps.checkSettings(); }, function(err) {
    return err.code === 'SMS_NOT_SET_UP' && /phone_otp/.test(err.message);
  });
  setSettings({ AUTH_2FA: 'optional', AUTH_2FA_METHODS: 'authenticator,sms' });
  assert.throws(function() { signInSteps.checkSettings(); }, /AUTH_2FA_METHODS has sms/);
  setSettings({ AUTH_2FA: 'off', AUTH_2FA_METHODS: 'sms' });
  assert.equal(signInSteps.checkSettings().mode, 'off', 'second step off: nothing is texted');
});

test('sign-in options: what the server offers; email is always a second step; a typo is refused by name', async function(t) {
  if (skip) return t.skip(skip);
  var r = await call('GET', '/auth/api/sign-in-options');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { methods: ['password'], twoFactor: 'off', twoFactorMethods: ['authenticator', 'email'], trustDays: 0 });

  setSettings({ AUTH_LOGIN_METHODS: 'password, email_otp', AUTH_2FA: 'Required', AUTH_2FA_METHODS: 'authenticator', AUTH_2FA_TRUST_DAYS: '30' });
  r = await call('GET', '/auth/api/sign-in-options');
  assert.deepEqual(r.body, { methods: ['password', 'email_otp'], twoFactor: 'required', twoFactorMethods: ['authenticator', 'email'], trustDays: 30 });

  setSettings({ AUTH_2FA: 'sometimes' });
  r = await call('GET', '/auth/api/sign-in-options');
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'AUTH_SETTING_INVALID');
  assert.match(r.body.error, /AUTH_2FA has "sometimes"/);
});

test('by default: password sign-in gives tokens, and a code sign-in is turned off', async function(t) {
  if (skip) return t.skip(skip);
  var p = await person();
  var r = await login(p);
  assert.equal(r.status, 200);
  assert.ok(r.body.accessToken && r.body.refreshToken);
  assert.equal(r.body.secondStep, undefined);

  r = await call('POST', '/auth/api/login/code', { email: p.email });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'METHOD_OFF');
});

test('password sign-in can be turned off', async function(t) {
  if (skip) return t.skip(skip);
  var p = await person();
  setSettings({ AUTH_LOGIN_METHODS: 'email_otp' });
  var r = await login(p);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'METHOD_OFF');
});

// ── a code instead of a password ───────────────────────────────────────────

test('email code: the same answer for anyone, a code only to a real account, used once', async function(t) {
  if (skip) return t.skip(skip);
  setSettings({ AUTH_LOGIN_METHODS: 'password,email_otp' });
  var p = await person();
  var before = mailbox.messages.length;

  var nobody = await call('POST', '/auth/api/login/code', { email: 'nobody@signin.test' });
  var real = await call('POST', '/auth/api/login/code', { email: p.email.toUpperCase() });
  assert.equal(nobody.status, 200);
  assert.deepEqual(nobody.body, real.body, 'no hint which address has an account');
  assert.equal(mailbox.messages.length, before + 1, 'one mail, to the real account');

  var code = lastMailedCode(p.email);
  assert.ok(code);
  var wrong = await call('POST', '/auth/api/login/code/verify', { email: p.email, code: code === '000000' ? '111111' : '000000' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, 'BAD_CODE');

  var ok = await call('POST', '/auth/api/login/code/verify', { email: p.email, code: code });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.user.id, p.id, 'the existing account — no new user');
  var me = await call('GET', '/auth/api/me', null, bearer(ok.body.accessToken));
  assert.equal(me.status, 200);
  assert.equal(Number((await knex('users').count('* as n'))[0].n), n, 'no account was created');

  var again = await call('POST', '/auth/api/login/code/verify', { email: p.email, code: code });
  assert.equal(again.status, 401);
  assert.equal(again.body.code, 'CODE_EXPIRED', 'a code works once');

  var stranger = await call('POST', '/auth/api/login/code/verify', { email: 'nobody@signin.test', code: '123456' });
  assert.equal(stranger.status, 401);
});

test('five codes per person per 15 minutes', async function(t) {
  if (skip) return t.skip(skip);
  setSettings({ AUTH_LOGIN_METHODS: 'email_otp' });
  var p = await person();
  for (var i = 0; i < 5; i++) {
    assert.equal((await call('POST', '/auth/api/login/code', { email: p.email })).status, 200);
  }
  var sixth = await call('POST', '/auth/api/login/code', { email: p.email });
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.code, 'TOO_MANY_CODES');
});

test('mobile: only a verified number signs in; one account per verified number; typed without +91 it still finds it', async function(t) {
  if (skip) return t.skip(skip);
  utils.sms.register('test-sms', {
    actions: { send: { url: 'http://127.0.0.1:' + smsServer.address().port + '/send', method: 'POST', contentType: 'json', body: { to: '{{to}}', message: '{{message}}' } } }
  });
  utils.sms.setDefault('test-sms');
  setSettings({ AUTH_LOGIN_METHODS: 'password,phone_otp' });

  var p = await person();
  var sent = texts.length;
  var r = await call('POST', '/auth/api/login/code', { phoneNumber: '+91 98765 43210' });
  assert.equal(r.status, 200);
  assert.equal(texts.length, sent, 'nobody has that number verified: nothing is texted');

  // Add and verify the number from the profile.
  var session = (await login(p)).body.accessToken;
  r = await call('POST', '/auth/api/request-phone-otp', { phoneNumber: '+91 98765-43210' }, bearer(session));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(texts[texts.length - 1].to, '+919876543210', 'cleaned before it is texted');
  r = await call('POST', '/auth/api/verify-phone-otp', { code: lastText('+919876543210') }, bearer(session));
  assert.equal(r.status, 200, JSON.stringify(r.body));

  // Someone else cannot take the same number.
  var q = await person();
  var qSession = (await login(q)).body.accessToken;
  r = await call('POST', '/auth/api/request-phone-otp', { phoneNumber: '+919876543210' }, bearer(qSession));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'PHONE_TAKEN');
  await assert.rejects(
    knex('users').where({ id: q.id }).update({ phoneNumber: '+91-98765-43210', phoneVerified: true }),
    /users_verified_phone_unique/, 'the database holds it too, however the number is written');

  // Sign in with the number, typed without the country code.
  r = await call('POST', '/auth/api/login/code', { phoneNumber: '98765 43210' });
  assert.equal(r.status, 200);
  var code = lastText('+919876543210');
  r = await call('POST', '/auth/api/login/code/verify', { phoneNumber: '9876543210', code: code });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.id, p.id, 'mapped to the email account that verified it');
});

// ── the second step ────────────────────────────────────────────────────────

async function setUpAuthenticator(token) {
  var r = await call('POST', '/auth/api/two-factor/authenticator', { issuer: 'GharArt CRM' }, bearer(token));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.otpauthUrl, /^otpauth:\/\/totp\/GharArt%20CRM%3A/);
  return r.body.secret;
}

function codeNow(secret, offset) {
  return utils.totp.codeAt(secret, Math.floor(Date.now() / 30000) + (offset || 0));
}

test('authenticator: set up with a code from the app, stored encrypted; then asked at sign-in, a code good once', async function(t) {
  if (skip) return t.skip(skip);
  setSettings({ AUTH_2FA: 'optional' });
  var p = await person();
  var token = (await login(p)).body.accessToken;

  var status = await call('GET', '/auth/api/two-factor', null, bearer(token));
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.method, null);
  assert.equal(status.body.authenticator, false);

  var secret = await setUpAuthenticator(token);
  var bad = await call('POST', '/auth/api/two-factor/authenticator/confirm', { code: '000000' === codeNow(secret) ? '111111' : '000000' }, bearer(token));
  assert.equal(bad.status, 401);
  var ok = await call('POST', '/auth/api/two-factor/authenticator/confirm', { code: codeNow(secret) }, bearer(token));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.method, 'authenticator');
  var row = await knex('users').where({ id: p.id }).first();
  assert.ok(row.totpSecret && row.totpSecret.indexOf(secret) === -1, 'never stored in clear');

  var first = await login(p);
  assert.equal(first.status, 200);
  assert.equal(first.body.accessToken, undefined, 'no tokens before the second step');
  assert.equal(first.body.secondStep.method, 'authenticator');
  assert.deepEqual(first.body.secondStep.methods, ['authenticator', 'email']);

  var ticket = first.body.secondStep.ticket;
  var wrong = await call('POST', '/auth/api/login/second-step/verify', { ticket: ticket, method: 'authenticator', code: codeNow(secret, 5) });
  assert.equal(wrong.status, 401);
  var right = await call('POST', '/auth/api/login/second-step/verify', { ticket: ticket, method: 'authenticator', code: codeNow(secret, -1) });
  assert.equal(right.status, 200, JSON.stringify(right.body));
  assert.ok(right.body.accessToken);
  assert.equal(right.body.trustToken, undefined, 'trusting a device is off');

  var reused = await call('POST', '/auth/api/login/second-step/verify', { ticket: ticket, method: 'authenticator', code: codeNow(secret, -1) });
  assert.equal(reused.body.code, 'SIGN_IN_EXPIRED', 'a ticket works once');

  var next = await login(p);
  var replay = await call('POST', '/auth/api/login/second-step/verify', { ticket: next.body.secondStep.ticket, method: 'authenticator', code: codeNow(secret, -1) });
  assert.equal(replay.status, 401, 'the same six digits do not work twice');
});

test('wrong app codes are counted per person, across sign-ins: the 10th locks the app out, email still works', async function(t) {
  if (skip) return t.skip(skip);
  setSettings({ AUTH_2FA: 'optional' });
  var p = await person();
  var token = (await login(p)).body.accessToken;
  var secret = await setUpAuthenticator(token);
  await call('POST', '/auth/api/two-factor/authenticator/confirm', { code: codeNow(secret) }, bearer(token));

  var wrong = codeNow(secret, 7);
  var last = null;
  for (var i = 0; i < 10; i++) {
    if (i % 4 === 0) last = (await login(p)).body.secondStep.ticket;   // a new sign-in every few tries
    var r = await call('POST', '/auth/api/login/second-step/verify', { ticket: last, method: 'authenticator', code: wrong });
    if (r.status === 401 && r.body.code === 'SIGN_IN_EXPIRED') { last = (await login(p)).body.secondStep.ticket; i--; continue; }
    if (i < 9) assert.equal(r.body.code, 'BAD_CODE', 'try ' + (i + 1));
    else { assert.equal(r.status, 429); assert.match(r.body.error, /Try again in \d+ minute/); }
  }
  var fresh = (await login(p)).body.secondStep.ticket;
  var right = await call('POST', '/auth/api/login/second-step/verify', { ticket: fresh, method: 'authenticator', code: codeNow(secret, 1) });
  assert.equal(right.status, 429, 'even the right app code waits');
  await call('POST', '/auth/api/login/second-step/send', { ticket: fresh, method: 'email' });
  var byEmail = await call('POST', '/auth/api/login/second-step/verify', { ticket: fresh, method: 'email', code: lastMailedCode(p.email) });
  assert.equal(byEmail.status, 200, 'the emailed code is the way in meanwhile');
});

test('cannot open the app: a code by email instead', async function(t) {
  if (skip) return t.skip(skip);
  setSettings({ AUTH_2FA: 'optional' });
  var p = await person();
  var token = (await login(p)).body.accessToken;
  var secret = await setUpAuthenticator(token);
  await call('POST', '/auth/api/two-factor/authenticator/confirm', { code: codeNow(secret) }, bearer(token));

  var first = await login(p);
  var ticket = first.body.secondStep.ticket;
  var sent = await call('POST', '/auth/api/login/second-step/send', { ticket: ticket, method: 'email' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.sentTo, 'p•••@signin.test');
  var done = await call('POST', '/auth/api/login/second-step/verify', { ticket: ticket, method: 'email', code: lastMailedCode(p.email) });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.ok(done.body.accessToken);
});

test('required: someone with nothing set up gets an emailed code; it cannot be turned off', async function(t) {
  if (skip) return t.skip(skip);
  setSettings({ AUTH_2FA: 'required' });
  var p = await person();
  var first = await login(p);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.secondStep.method, 'email');
  assert.deepEqual(first.body.secondStep.methods, ['email']);
  assert.equal(first.body.secondStep.sentTo, 'p•••@signin.test');
  var done = await call('POST', '/auth/api/login/second-step/verify', { ticket: first.body.secondStep.ticket, method: 'email', code: lastMailedCode(p.email) });
  assert.equal(done.status, 200);

  var off = await call('POST', '/auth/api/two-factor/method', { method: null }, bearer(done.body.accessToken));
  assert.equal(off.status, 409);
  assert.equal(off.body.code, 'REQUIRED');
});

test('the second step never asks again for what the first proved', async function(t) {
  if (skip) return t.skip(skip);
  setSettings({ AUTH_LOGIN_METHODS: 'password,email_otp', AUTH_2FA: 'required' });
  var p = await person();

  // Only email to offer, and the first step was an emailed code: that counts.
  await call('POST', '/auth/api/login/code', { email: p.email });
  var r = await call('POST', '/auth/api/login/code/verify', { email: p.email, code: lastMailedCode(p.email) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.accessToken, 'signed in without a second email');

  // With an authenticator set up, the emailed sign-in code is followed by the app.
  var secret = await setUpAuthenticator(r.body.accessToken);
  await call('POST', '/auth/api/two-factor/authenticator/confirm', { code: codeNow(secret) }, bearer(r.body.accessToken));
  await call('POST', '/auth/api/login/code', { email: p.email });
  r = await call('POST', '/auth/api/login/code/verify', { email: p.email, code: lastMailedCode(p.email) });
  assert.equal(r.body.accessToken, undefined);
  assert.deepEqual(r.body.secondStep.methods, ['authenticator']);
});

test('trust this device: skipped next time, until an admin resets the second step', async function(t) {
  if (skip) return t.skip(skip);
  setSettings({ AUTH_2FA: 'required', AUTH_2FA_TRUST_DAYS: '30' });
  var p = await person();
  var adminP = await person({ role: 'Admin' });

  var first = await login(p);
  assert.equal(first.body.secondStep.trustDays, 30);
  var done = await call('POST', '/auth/api/login/second-step/verify', {
    ticket: first.body.secondStep.ticket, method: 'email', code: lastMailedCode(p.email), trustDevice: true
  });
  assert.equal(done.status, 200);
  var trustToken = done.body.trustToken;
  assert.ok(trustToken);

  var trusted = await login(p, { trustToken: trustToken });
  assert.ok(trusted.body.accessToken, 'this device is not asked');
  var other = await login(p, { trustToken: 'not-a-real-token' });
  assert.ok(other.body.secondStep, 'another device is');

  // The admin signs in (its own second step), then resets p's.
  var a = await login(adminP);
  var aDone = await call('POST', '/auth/api/login/second-step/verify', { ticket: a.body.secondStep.ticket, method: 'email', code: lastMailedCode(adminP.email) });
  var reset = await call('POST', '/auth/api/admin/users/' + p.id + '/two-factor/reset', {}, bearer(aDone.body.accessToken));
  assert.equal(reset.status, 200, JSON.stringify(reset.body));

  var after = await login(p, { trustToken: trustToken });
  assert.ok(after.body.secondStep, 'after a reset, a trusted device asks again');
});

test('a Viewer cannot reset someone else\'s second step', async function(t) {
  if (skip) return t.skip(skip);
  var p = await person();
  var viewer = await person();
  var token = (await login(viewer)).body.accessToken;
  var r = await call('POST', '/auth/api/admin/users/' + p.id + '/two-factor/reset', {}, bearer(token));
  assert.equal(r.status, 403);
});

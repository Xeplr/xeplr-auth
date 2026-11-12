// INTERNAL TOKENS on the real Redis: the server makes one for itself, the
// auth check serves it as the user it acts as, an unknown one is refused, it
// ends when its time is up, and a sign-in token is checked as before.
process.env.REDIS_PREFIX = process.env.REDIS_PREFIX || 'xeplr-auth-test:';
process.env.AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET || 'test-secret-for-internal-tokens';
var { test, after } = require('node:test');
var assert = require('node:assert/strict');
var { cache } = require('@xeplr/utils');
var { createInternalToken, readInternalToken, isInternalToken } = require('../lib/internalToken');
var authMiddleware = require('../lib/authMiddleware');

after(async function() { try { await cache.getClient().quit(); } catch (e) { /* gone */ } });

function call(token) {
  return new Promise(function(resolve) {
    var req = { headers: token ? { authorization: 'Bearer ' + token } : {} };
    var res = { status: function(code) { return { json: function(body) { resolve({ status: code, body: body }); } }; }, setHeader: function() {} };
    authMiddleware(req, res, function() { resolve({ status: 'next', user: req.user }); });
  });
}

test('the server makes one: long and random, acting as the user it was made for', async function() {
  var token = await createInternalToken({ id: 'u1', email: 'a@x.com', name: 'Asha', roles: [{ name: 'Creator' }] });
  assert.ok(isInternalToken(token) && token.length > 40, token);
  assert.notEqual(token, await createInternalToken({ id: 'u1' }), 'never the same twice');
  var served = await call(token);
  assert.equal(served.status, 'next');
  assert.deepEqual(served.user, { id: 'u1', email: 'a@x.com', name: 'Asha', roles: ['Creator'], internal: true });
  assert.equal((await call(token)).status, 'next', 'usable for its life, not once');
});

test('one nobody made is refused', async function() {
  assert.deepEqual(await call('xit_' + 'a'.repeat(43)), { status: 401, body: { error: 'Invalid or expired token' } });
  assert.equal(await readInternalToken('not-internal'), null);
});

test('it ends when its time is up', async function() {
  var token = await createInternalToken({ id: 'u2' }, { ttl: 1 });
  assert.equal((await call(token)).status, 'next');
  await new Promise(function(r) { setTimeout(r, 1300); });
  assert.equal((await call(token)).status, 401);
});

test('30 seconds unless asked, never more than 5 minutes', async function() {
  var client = cache.getClient();
  var t30 = await createInternalToken({ id: 'u3' });
  var tMax = await createInternalToken({ id: 'u3' }, { ttl: 99999 });
  var ttl = async function(t) { return client.ttl('token:internal:' + t); };
  assert.ok((await ttl(t30)) <= 30 && (await ttl(t30)) > 25);
  assert.ok((await ttl(tMax)) <= 300 && (await ttl(tMax)) > 290);
});

test('a sign-in token is checked as before', async function() {
  assert.equal((await call('not.a.jwt')).status, 401);
  assert.deepEqual(await call(null), { status: 401, body: { error: 'No token provided' } });
});

test('a token needs a user', async function() {
  await assert.rejects(createInternalToken({}), /user.id is required/);
});

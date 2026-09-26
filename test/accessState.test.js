// The API gate answers enabled / disabled / hidden, not true/false.
var { test } = require('node:test');
var assert = require('node:assert/strict');
var http = require('node:http');
var express = require('express');

var service = require('../lib/accessService');
var { ACCESS_STATES, apiStateFor } = service;

test('three states', function() {
  assert.deepEqual(ACCESS_STATES, ['enabled', 'disabled', 'hidden']);
});

test('open APIs are enabled; mapped ones are enabled for a holder, hidden otherwise', function() {
  assert.equal(apiStateFor({ exists: false }, []), 'enabled');
  assert.equal(apiStateFor({ exists: true, isPublic: true, roleIds: ['r1'] }, []), 'enabled');
  assert.equal(apiStateFor({ exists: true, unmapped: true, roleIds: [] }, []), 'enabled');
  assert.equal(apiStateFor({ exists: true, roleIds: ['r1'] }, ['r1']), 'enabled');
  assert.equal(apiStateFor({ exists: true, roleIds: ['r1'] }, ['r2']), 'hidden');
  assert.equal(apiStateFor({ exists: true, roleIds: ['r1'] }, undefined), 'hidden');
  // A disabled mapping row: shown, not usable. The most open role wins.
  assert.equal(apiStateFor({ exists: true, roleIds: [], disabledRoleIds: ['r1'] }, ['r1']), 'disabled');
  assert.equal(apiStateFor({ exists: true, roleIds: ['r2'], disabledRoleIds: ['r1'] }, ['r1', 'r2']), 'enabled');
  assert.equal(apiStateFor({ exists: true, roleIds: [], disabledRoleIds: ['r1'] }, ['r3']), 'hidden');
});

test('the middleware lets enabled through and refuses disabled and hidden with their codes', async function() {
  var state = 'enabled';
  service.getApiRule = async function() { return { exists: true, roleIds: ['r1'] }; };
  service.userApiState = async function() { return state; };
  require.cache[require.resolve('../lib/authHelper')].exports.verifyToken = function() { return { id: 'u1' }; };
  delete require.cache[require.resolve('../lib/accessMiddleware')];
  var { accessMiddleware } = require('../lib/accessMiddleware');

  var app = express();
  app.use('/api', accessMiddleware(), function(req, res) { res.json({ ok: true }); });
  var server = http.createServer(app).listen(0);
  var base = 'http://127.0.0.1:' + server.address().port;
  async function hit() {
    var res = await fetch(base + '/api/orders', { headers: { authorization: 'Bearer t' } });
    return { status: res.status, body: await res.json() };
  }
  try {
    assert.deepEqual(await hit(), { status: 200, body: { ok: true } });
    state = 'disabled';
    var r = await hit();
    assert.equal(r.status, 403); assert.equal(r.body.code, 'DISABLED');
    state = 'hidden';
    r = await hit();
    assert.equal(r.status, 403); assert.equal(r.body.code, 'HIDDEN');
    state = 'something-new';
    r = await hit();
    assert.equal(r.status, 403, 'an unknown state is refused, never let through');
  } finally {
    server.close();
  }
});

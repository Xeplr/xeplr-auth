// GET /verify: the token AND the access state for the API being served,
// always both. The route matcher decides which catalog row a request is.
var { test } = require('node:test');
var assert = require('node:assert/strict');
var http = require('node:http');
var express = require('express');

var { matchApi } = require('../lib/apiMatch');

test('a request matches its catalog row: method, bare path, :params, most exact wins', function() {
  var names = ['GET /logs', '/auth/api/me', 'GET /widget-templates/:id', 'POST /dashboards/:id/group',
               '/dashboards/:id/:x', 'POST /auth/api/admin/master/roles', '/auth/api/admin/master/roles'];
  assert.equal(matchApi(names, 'GET', '/logs'), 'GET /logs');
  assert.equal(matchApi(names, 'POST', '/logs'), null, 'a METHOD row covers that method only');
  assert.equal(matchApi(names, 'POST', '/auth/api/me'), '/auth/api/me', 'a bare path covers every method');
  assert.equal(matchApi(names, 'get', '/widget-templates/abc'), 'GET /widget-templates/:id');
  assert.equal(matchApi(names, 'GET', '/widget-templates/abc/extra'), null, 'segment counts must agree');
  assert.equal(matchApi(names, 'POST', '/dashboards/d1/group'), 'POST /dashboards/:id/group', 'more literal segments win');
  assert.equal(matchApi(names, 'POST', '/auth/api/admin/master/roles'), 'POST /auth/api/admin/master/roles', 'a method beats none');
  assert.equal(matchApi(names, 'GET', '/auth/api/admin/master/roles'), '/auth/api/admin/master/roles');
  assert.equal(matchApi(names, 'GET', '/logs/?x=1'), 'GET /logs', 'trailing slash and query ignored');
  assert.equal(matchApi(names, 'GET', '/nothing'), null);
  assert.equal(matchApi(undefined, 'GET', '/logs'), null);
});

test('the route answers enabled with the user, and refuses disabled, hidden and a missing request', async function() {
  var state = 'enabled';
  var asked = null;
  var service = require('../lib/accessService');
  service.requestApiState = async function(userId, method, path) { asked = [userId, method, path]; return { api: 'GET /logs', state: state }; };
  service.getUserAccess = async function() { return { roles: ['Viewer'] }; };
  require.cache[require.resolve('../lib/authMiddleware')] = {
    id: 'authMiddleware', loaded: true,
    exports: function(req, res, next) { req.user = { id: 'u1' }; next(); }
  };
  var createAuthRouter = require('../lib/authRouter');

  var app = express();
  app.use('/auth/api', createAuthRouter());
  var server = http.createServer(app).listen(0);
  var base = 'http://127.0.0.1:' + server.address().port + '/auth/api/verify';
  async function hit(headers) {
    var res = await fetch(base, { headers: headers });
    return { status: res.status, body: await res.json() };
  }
  var req = { 'x-verify-method': 'GET', 'x-verify-path': '/logs' };
  try {
    var r = await hit(req);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { user: { id: 'u1' }, access: { roles: ['Viewer'] }, state: 'enabled', api: 'GET /logs' });
    assert.deepEqual(asked, ['u1', 'GET', '/logs']);

    state = 'disabled';
    r = await hit(req);
    assert.equal(r.status, 403); assert.equal(r.body.code, 'DISABLED');

    state = 'hidden';
    r = await hit(req);
    assert.equal(r.status, 403); assert.equal(r.body.code, 'HIDDEN');

    state = 'something-new';
    r = await hit(req);
    assert.equal(r.status, 403, 'an unknown state is refused');

    r = await hit({ 'x-verify-method': 'GET' });
    assert.equal(r.status, 400, 'no request named: nothing to check, so refused');
    assert.equal(r.body.code, 'NO_REQUEST');
  } finally {
    server.close();
  }
});

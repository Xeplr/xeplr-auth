// The membership check: a company or workspace in the headers needs a
// membership row, except for Super Admin, who goes anywhere.
var { test } = require('node:test');
var assert = require('node:assert/strict');

var db = require('@xeplr/db');
db.getMtConfig = function() {
  return { enabled: true, slots: { l1: { name: 'companyId', header: 'x-company-id' }, l2: { name: 'workspaceId', header: 'x-workspace-id' } } };
};
var mtMembershipMiddleware = require('../lib/mtMembershipMiddleware');

// A stand-in for the model: one membership, u1 in company c1.
var Model = { query: function() {
  var where = null;
  var q = { where: function(w) { where = w; return q; }, first: async function() {
    return (where.userId === 'u1' && where.level === 'l1' && where.value === 'c1') ? { id: 'm1' } : undefined;
  } };
  return q;
} };

function run(user, headers) {
  return new Promise(function(resolve) {
    var res = { status: function(code) { return { json: function(body) { resolve({ status: code, body: body }); } }; } };
    mtMembershipMiddleware({ userTenantsMapping: Model })({ user: user, headers: headers }, res, function() { resolve({ status: 'next' }); });
  });
}

test('a member passes, a non-member is refused', async function() {
  assert.equal((await run({ id: 'u1', roles: ['Viewer'] }, { 'x-company-id': 'c1' })).status, 'next');
  var r = await run({ id: 'u1', roles: ['Viewer'] }, { 'x-company-id': 'c2' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /companyId "c2"/);
});

test('Super Admin goes into any company and workspace without a membership row', async function() {
  assert.equal((await run({ id: 'sa', roles: ['Super Admin'] }, { 'x-company-id': 'c2', 'x-workspace-id': 'w9' })).status, 'next');
});

test('a role merely named like it does not', async function() {
  assert.equal((await run({ id: 'u2', roles: ['Super Admins', 'Admin'] }, { 'x-company-id': 'c2' })).status, 403);
});

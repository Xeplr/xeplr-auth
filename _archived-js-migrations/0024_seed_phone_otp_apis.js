// Catalog entries for the phone-OTP routes (0023), matching how every other
// auth route is registered (e.g. /auth/api/me) — not enforced via
// accessMiddleware today (auth's own router gates per-route via
// authMiddleware directly), but keeps Access Matrix / the apis table complete.
var crypto = require('crypto');
function generateId() { return crypto.randomBytes(12).toString('hex').substring(0, 25); }
var MT_ALL = '*';

var APIS = [
  { name: '/auth/api/request-phone-otp', apiGroup: 'account:edit', isPublic: false },
  { name: '/auth/api/verify-phone-otp', apiGroup: 'account:edit', isPublic: false }
];

async function insertIfAbsent(knex, table, where, extra) {
  var exists = await knex(table).where(where).first();
  if (exists) return exists;
  var row = Object.assign({ id: generateId() }, where, extra);
  await knex(table).insert(row);
  return row;
}

exports.up = async function (knex) {
  var now = new Date().toISOString();
  var stamp = { isActive: true, recordCreatedDate: now, recordModifiedDate: now, mtId1: MT_ALL };
  for (var i = 0; i < APIS.length; i++) {
    await insertIfAbsent(knex, 'apis', { name: APIS[i].name }, Object.assign({ apiGroup: APIS[i].apiGroup, isPublic: APIS[i].isPublic }, stamp));
  }
};

exports.down = async function (knex) {
  await knex('apis').whereIn('name', APIS.map(function (x) { return x.name; })).del();
};

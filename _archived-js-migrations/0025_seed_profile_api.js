// Catalog entry for GET/PUT /auth/api/profile (0025's authRouter.js addition),
// matching how every other auth route is registered (e.g. /auth/api/me).
var crypto = require('crypto');
function generateId() { return crypto.randomBytes(12).toString('hex').substring(0, 25); }
var MT_ALL = '*';

exports.up = async function (knex) {
  var now = new Date().toISOString();
  var existing = await knex('apis').where({ name: '/auth/api/profile' }).first();
  if (existing) return;
  await knex('apis').insert({
    id: generateId(),
    name: '/auth/api/profile',
    apiGroup: 'account:view',
    isPublic: false,
    isActive: true,
    recordCreatedDate: now,
    recordModifiedDate: now,
    mtId1: MT_ALL
  });
};

exports.down = async function (knex) {
  await knex('apis').where({ name: '/auth/api/profile' }).del();
};

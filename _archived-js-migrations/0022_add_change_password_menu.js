// Fixes a bug in 0021: "Change Password" was assumed to already exist as a
// `menus` row (it doesn't — 0019 only ever seeded it into `uiPages`, not
// `menus`), so 0021's isPublic:true UPDATE silently affected zero rows.
// Insert it properly here, basic tier (isPublic:true — see accessService.js
// getPublicItems() for why that's enough to reach every role, present or future).
var crypto = require('crypto');
function generateId() { return crypto.randomBytes(12).toString('hex').substring(0, 25); }
var MT_ALL = '*';

exports.up = async function (knex) {
  var now = new Date().toISOString();
  var existing = await knex('menus').where({ name: 'Change Password' }).first();
  if (existing) {
    await knex('menus').where({ name: 'Change Password' }).update({ isPublic: true });
    return;
  }
  await knex('menus').insert({
    id: generateId(),
    name: 'Change Password',
    menuGroup: 'account:edit',
    isPublic: true,
    isActive: true,
    recordCreatedDate: now,
    recordModifiedDate: now,
    mtId1: MT_ALL,
    mtId2: MT_ALL,
    mtId3: MT_ALL,
    mtId4: MT_ALL,
  });
};

exports.down = async function (knex) {
  await knex('menus').where({ name: 'Change Password' }).del();
};

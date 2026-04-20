var crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(12).toString('hex').substring(0, 25);
}

var now = new Date().toISOString();
var MT_ALL = '*';

var ROLES = ['Super Admin', 'Admin', 'Editor', 'Viewer'];

exports.seed = async function(knex) {
  for (var i = 0; i < ROLES.length; i++) {
    var exists = await knex('roles').where({ name: ROLES[i] }).first();
    if (!exists) {
      await knex('roles').insert({
        id: generateId(),
        name: ROLES[i],
        isActive: true,
        recordCreatedDate: now,
        recordModifiedDate: now,
        mtId1: MT_ALL
      });
    }
  }
};

var crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(12).toString('hex').substring(0, 25);
}

var now = new Date().toISOString();
var MT_ALL = '*';

var MENUS = [
  { name: 'Profile', menuGroup: 'account:view', isPublic: false },
  { name: 'User Roles', menuGroup: 'users:view', isPublic: false },
  { name: 'Access Matrix', menuGroup: 'access:view', isPublic: false },
  { name: 'Master Settings', menuGroup: 'settings:view', isPublic: false },
  { name: 'Tenant Management', menuGroup: 'tenants:view', isPublic: false },
];

exports.seed = async function(knex) {
  for (var i = 0; i < MENUS.length; i++) {
    var menu = MENUS[i];
    var exists = await knex('menus').where({ name: menu.name }).first();
    if (!exists) {
      await knex('menus').insert({
        id: generateId(),
        name: menu.name,
        menuGroup: menu.menuGroup,
        isPublic: menu.isPublic,
        isActive: true,
        recordCreatedDate: now,
        recordModifiedDate: now,
        mtId1: MT_ALL
      });
    }
  }
};

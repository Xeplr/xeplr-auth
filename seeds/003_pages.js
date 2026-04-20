var crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(12).toString('hex').substring(0, 25);
}

var now = new Date().toISOString();
var MT_ALL = '*';

var PAGES = [
  { name: 'Login', uiPagesGroup: '', isPublic: true },
  { name: 'Register', uiPagesGroup: '', isPublic: true },
  { name: 'Forgot Password', uiPagesGroup: '', isPublic: true },
  { name: 'Reset Password', uiPagesGroup: '', isPublic: true },
  { name: 'Activate Account', uiPagesGroup: '', isPublic: true },
  { name: 'Profile', uiPagesGroup: 'account:view', isPublic: false },
  { name: 'Change Password', uiPagesGroup: 'account:edit', isPublic: false },
  { name: 'User Roles', uiPagesGroup: 'users:view', isPublic: false },
  { name: 'Access Matrix', uiPagesGroup: 'access:view', isPublic: false },
  { name: 'Master Settings', uiPagesGroup: 'settings:view', isPublic: false },
  { name: 'Tenant Management', uiPagesGroup: 'tenants:view', isPublic: false },
];

exports.seed = async function(knex) {
  for (var i = 0; i < PAGES.length; i++) {
    var page = PAGES[i];
    var exists = await knex('uiPages').where({ name: page.name }).first();
    if (!exists) {
      await knex('uiPages').insert({
        id: generateId(),
        name: page.name,
        uiPagesGroup: page.uiPagesGroup,
        isPublic: page.isPublic,
        isActive: true,
        recordCreatedDate: now,
        recordModifiedDate: now,
        mtId1: MT_ALL
      });
    }
  }
};

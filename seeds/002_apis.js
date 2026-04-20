var crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(12).toString('hex').substring(0, 25);
}

var now = new Date().toISOString();
var MT_ALL = '*';

var APIS = [
  // Auth APIs (public — no role needed)
  { name: '/auth/api/register', apiGroup: '', isPublic: true },
  { name: '/auth/api/activate', apiGroup: '', isPublic: true },
  { name: '/auth/api/login', apiGroup: '', isPublic: true },
  { name: '/auth/api/forgot-password', apiGroup: '', isPublic: true },
  { name: '/auth/api/reset-password', apiGroup: '', isPublic: true },
  { name: '/auth/api/refresh', apiGroup: '', isPublic: true },
  { name: '/auth/api/logout', apiGroup: '', isPublic: true },
  { name: '/auth/api/me', apiGroup: 'account:view', isPublic: false },

  // Admin APIs — user/role management
  { name: '/auth/api/admin/users', apiGroup: 'users:view', isPublic: false },
  { name: '/auth/api/admin/roles', apiGroup: 'users:view', isPublic: false },
  { name: '/auth/api/admin/user-role', apiGroup: 'users:edit', isPublic: false },
  { name: '/auth/api/admin/access-items', apiGroup: 'access:view', isPublic: false },
  { name: '/auth/api/admin/access-role', apiGroup: 'access:edit', isPublic: false },
  { name: '/auth/api/admin/module-role', apiGroup: 'access:edit', isPublic: false },

  // Admin APIs — tenant management
  { name: '/auth/api/admin/tenants', apiGroup: 'tenants:view', isPublic: false },
  { name: '/auth/api/admin/tenants/save', apiGroup: 'tenants:edit', isPublic: false },
  { name: '/auth/api/admin/tenants/delete', apiGroup: 'tenants:delete', isPublic: false },
  { name: '/auth/api/admin/tenants/assign-user', apiGroup: 'tenants:edit', isPublic: false },

  // Admin APIs — master settings
  { name: '/auth/api/admin/master/roles', apiGroup: 'settings:view', isPublic: false },
  { name: '/auth/api/admin/master/roles/save', apiGroup: 'settings:edit', isPublic: false },
  { name: '/auth/api/admin/master/roles/delete', apiGroup: 'settings:delete', isPublic: false },
  { name: '/auth/api/admin/master/apis', apiGroup: 'settings:view', isPublic: false },
  { name: '/auth/api/admin/master/apis/save', apiGroup: 'settings:edit', isPublic: false },
  { name: '/auth/api/admin/master/apis/delete', apiGroup: 'settings:delete', isPublic: false },
  { name: '/auth/api/admin/master/pages', apiGroup: 'settings:view', isPublic: false },
  { name: '/auth/api/admin/master/pages/save', apiGroup: 'settings:edit', isPublic: false },
  { name: '/auth/api/admin/master/pages/delete', apiGroup: 'settings:delete', isPublic: false },
  { name: '/auth/api/admin/master/elements', apiGroup: 'settings:view', isPublic: false },
  { name: '/auth/api/admin/master/elements/save', apiGroup: 'settings:edit', isPublic: false },
  { name: '/auth/api/admin/master/elements/delete', apiGroup: 'settings:delete', isPublic: false },
  { name: '/auth/api/admin/master/menus', apiGroup: 'settings:view', isPublic: false },
  { name: '/auth/api/admin/master/menus/save', apiGroup: 'settings:edit', isPublic: false },
  { name: '/auth/api/admin/master/menus/delete', apiGroup: 'settings:delete', isPublic: false },
];

exports.seed = async function(knex) {
  for (var i = 0; i < APIS.length; i++) {
    var api = APIS[i];
    var exists = await knex('apis').where({ name: api.name }).first();
    if (!exists) {
      await knex('apis').insert({
        id: generateId(),
        name: api.name,
        apiGroup: api.apiGroup,
        isPublic: api.isPublic,
        isActive: true,
        recordCreatedDate: now,
        recordModifiedDate: now,
        mtId1: MT_ALL
      });
    }
  }
};

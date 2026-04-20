var crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(12).toString('hex').substring(0, 25);
}

var now = new Date().toISOString();
var MT_ALL = '*';
var DEFAULT_TENANT_NAME = 'Default';
var DEFAULT_TENANT_CODE = 'default';

exports.seed = async function(knex) {
  // Create default tenant if not exists
  var tenant = await knex('tenants').where({ code: DEFAULT_TENANT_CODE }).first();
  if (!tenant) {
    var tenantId = generateId();
    await knex('tenants').insert({
      id: tenantId,
      name: DEFAULT_TENANT_NAME,
      code: DEFAULT_TENANT_CODE,
      level: 1,
      description: 'Default tenant',
      mtId1: MT_ALL,
      isActive: true,
      recordCreatedDate: now,
      recordModifiedDate: now
    });
    tenant = { id: tenantId };
  }

  // Assign all Super Admin users to the default tenant
  var superAdminRole = await knex('roles').where({ name: 'Super Admin' }).first();
  if (!superAdminRole) return;

  var superAdminMappings = await knex('userRolesMapping').where({ roleId: superAdminRole.id });
  for (var i = 0; i < superAdminMappings.length; i++) {
    var userId = superAdminMappings[i].userId;
    var exists = await knex('userTenantsMapping').where({ userId: userId, tenantId: tenant.id }).first();
    if (!exists) {
      await knex('userTenantsMapping').insert({
        id: generateId(),
        userId: userId,
        tenantId: tenant.id,
        isActive: true,
        recordCreatedDate: now,
        recordModifiedDate: now
      });
    }
  }
};

// Add roleId to userTenantsMapping so a tenant grant can carry a SCOPED role:
// a row becomes (user, tenant, role) — e.g. "CompanyAdmin of Acme", "Viewer of
// workspace Q". Nullable & backward-compatible: a null roleId is a plain access
// grant (the prior behavior). Global roles still live in userRolesMapping; this
// is the per-tenant axis.

exports.up = function (knex) {
  return knex.schema.alterTable('userTenantsMapping', function (table) {
    table.string('roleId', 25).references('id').inTable('roles');
    table.index('roleId');
    table.index(['userId', 'tenantId']);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('userTenantsMapping', function (table) {
    table.dropColumn('roleId');
  });
};

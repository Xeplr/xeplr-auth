exports.up = function(knex) {
  return knex.schema.createTable('userTenantsMapping', function(table) {
    table.string('id', 25).primary();
    table.string('userId', 25).notNullable().references('id').inTable('users');
    table.string('tenantId', 25).notNullable();   // the app's own tenant id (e.g. companyId/workspaceId). NOT an FK — auth does not own a tenant tree.
    table.string('mtId1', 25);
    table.string('mtId2', 25);
    table.string('mtId3', 25);
    table.string('mtId4', 25);
    table.boolean('isActive').defaultTo(true);
    table.timestamp('recordCreatedDate');
    table.timestamp('recordModifiedDate');
    table.string('recordCreatedBy', 25);
    table.string('recordModifiedBy', 25);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('userTenantsMapping');
};

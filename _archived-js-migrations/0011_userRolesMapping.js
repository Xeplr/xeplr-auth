exports.up = function(knex) {
  return knex.schema.createTable('userRolesMapping', function(table) {
    table.string('id', 25).primary();
    table.string('userId', 25).references('id').inTable('users');
    table.string('roleId', 25).references('id').inTable('roles');
    table.boolean('isActive').defaultTo(false);
    table.timestamp('recordCreatedDate');
    table.timestamp('recordModifiedDate');
    table.string('recordCreatedBy', 25);
    table.string('recordModifiedBy', 25);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('userRolesMapping');
};

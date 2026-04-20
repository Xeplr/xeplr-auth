exports.up = function(knex) {
  return knex.schema.createTable('uiElementsRolesMapping', function(table) {
    table.string('id', 25).primary();
    table.string('roleId', 25).references('id').inTable('roles');
    table.string('uiElementId', 25).references('id').inTable('uiElements');
    table.boolean('isActive').defaultTo(false);
    table.timestamp('recordCreatedDate');
    table.timestamp('recordModifiedDate');
    table.string('recordCreatedBy', 25);
    table.string('recordModifiedBy', 25);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('uiElementsRolesMapping');
};

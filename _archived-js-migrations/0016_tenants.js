exports.up = function(knex) {
  return knex.schema.createTable('tenants', function(table) {
    table.string('id', 25).primary();
    table.string('name', 255).notNullable();
    table.string('code', 50);
    table.integer('level').defaultTo(1);
    table.string('parentId', 25);
    table.string('description', 500);
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
  return knex.schema.dropTableIfExists('tenants');
};

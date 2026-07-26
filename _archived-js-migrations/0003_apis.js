exports.up = function(knex) {
  return knex.schema.createTable('apis', function(table) {
    table.string('id', 25).primary();
    table.string('name', 255);
    table.string('apiGroup', 255);
    table.boolean('isActive').defaultTo(false);
    table.timestamp('recordCreatedDate');
    table.timestamp('recordModifiedDate');
    table.string('recordCreatedBy', 25);
    table.string('recordModifiedBy', 25);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('apis');
};

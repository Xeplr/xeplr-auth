exports.up = function(knex) {
  return knex.schema.createTable('users', function(table) {
    table.string('id', 25).primary();
    table.string('email', 255).notNullable();
    table.string('phoneNumber', 255);
    table.string('name', 255);
    table.string('pwd', 255);
    table.string('pwdSalt', 100);
    table.boolean('isActive').defaultTo(false);
    table.boolean('isActivated').defaultTo(false);
    table.timestamp('activatedOn');
    table.string('activatedBy', 25);
    table.timestamp('recordCreatedDate');
    table.timestamp('recordModifiedDate');
    table.string('recordCreatedBy', 25);
    table.string('recordModifiedBy', 25);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('users');
};

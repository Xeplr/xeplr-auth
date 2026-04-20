exports.up = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.string('activationToken', 255);
    table.string('normalizedEmail', 255).index();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.dropColumn('activationToken');
    table.dropColumn('normalizedEmail');
  });
};

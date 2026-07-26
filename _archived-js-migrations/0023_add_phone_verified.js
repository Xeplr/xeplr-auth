exports.up = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.boolean('phoneVerified').defaultTo(false);
    table.timestamp('phoneVerifiedOn');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.dropColumn('phoneVerified');
    table.dropColumn('phoneVerifiedOn');
  });
};

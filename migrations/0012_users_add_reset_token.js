exports.up = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.string('resetToken', 255);
    table.timestamp('resetTokenExpiry');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.dropColumn('resetToken');
    table.dropColumn('resetTokenExpiry');
  });
};

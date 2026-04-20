exports.up = function(knex) {
  return Promise.all([
    knex.schema.alterTable('apis', function(table) {
      table.boolean('isPublic').defaultTo(false);
    }),
    knex.schema.alterTable('uiPages', function(table) {
      table.boolean('isPublic').defaultTo(false);
    }),
    knex.schema.alterTable('menus', function(table) {
      table.boolean('isPublic').defaultTo(false);
    })
  ]);
};

exports.down = function(knex) {
  return Promise.all([
    knex.schema.alterTable('apis', function(table) {
      table.dropColumn('isPublic');
    }),
    knex.schema.alterTable('uiPages', function(table) {
      table.dropColumn('isPublic');
    }),
    knex.schema.alterTable('menus', function(table) {
      table.dropColumn('isPublic');
    })
  ]);
};

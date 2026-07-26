var TABLES = [
  'users',
  'roles',
  'apis',
  'uiPages',
  'uiElements',
  'menus',
  'userRolesMapping',
  'apisRolesMapping',
  'uiPagesRolesMapping',
  'uiElementsRolesMapping',
  'menuRolesMapping'
];

exports.up = async function(knex) {
  for (var i = 0; i < TABLES.length; i++) {
    var exists = await knex.schema.hasColumn(TABLES[i], 'mtId1');
    if (!exists) {
      await knex.schema.alterTable(TABLES[i], function(table) {
        table.string('mtId1', 25);
        table.string('mtId2', 25);
        table.string('mtId3', 25);
        table.string('mtId4', 25);
      });
    }
  }
};

exports.down = async function(knex) {
  for (var i = 0; i < TABLES.length; i++) {
    var exists = await knex.schema.hasColumn(TABLES[i], 'mtId1');
    if (exists) {
      await knex.schema.alterTable(TABLES[i], function(table) {
        table.dropColumn('mtId1');
        table.dropColumn('mtId2');
        table.dropColumn('mtId3');
        table.dropColumn('mtId4');
      });
    }
  }
};

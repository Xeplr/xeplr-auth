var crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(12).toString('hex').substring(0, 25);
}

var now = new Date().toISOString();
var MT_ALL = '*';

var ADMIN_ROLES = ['Super Admin', 'Admin'];

var MAPPINGS = [
  { table: 'apisRolesMapping', source: 'apis', fk: 'apiId' },
  { table: 'uiPagesRolesMapping', source: 'uiPages', fk: 'uiPageId' },
  { table: 'uiElementsRolesMapping', source: 'uiElements', fk: 'uiElementId' },
  { table: 'menuRolesMapping', source: 'menus', fk: 'menuId' },
];

exports.seed = async function(knex) {
  var roles = await knex('roles').whereIn('name', ADMIN_ROLES).select('id', 'name');
  if (roles.length === 0) return;

  for (var m = 0; m < MAPPINGS.length; m++) {
    var mapping = MAPPINGS[m];
    var items = await knex(mapping.source).select('id');

    for (var r = 0; r < roles.length; r++) {
      var roleId = roles[r].id;

      for (var i = 0; i < items.length; i++) {
        var where = { roleId: roleId };
        where[mapping.fk] = items[i].id;

        var exists = await knex(mapping.table).where(where).first();
        if (!exists) {
          var row = {
            id: generateId(),
            roleId: roleId,
            recordCreatedDate: now,
            recordModifiedDate: now,
            mtId1: MT_ALL
          };
          row[mapping.fk] = items[i].id;
          await knex(mapping.table).insert(row);
        }
      }
    }
  }
};

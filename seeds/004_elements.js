var crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(12).toString('hex').substring(0, 25);
}

var now = new Date().toISOString();
var MT_ALL = '*';

var ELEMENTS = [
  { name: 'Assign Role Button', uiElementsGroup: 'users:edit' },
  { name: 'Remove Role Button', uiElementsGroup: 'users:edit' },
  { name: 'Toggle Access Checkbox', uiElementsGroup: 'access:edit' },
  { name: 'Toggle Module Access Checkbox', uiElementsGroup: 'access:edit' },
  { name: 'Add Role Button', uiElementsGroup: 'settings:edit' },
  { name: 'Delete Role Button', uiElementsGroup: 'settings:delete' },
  { name: 'Add API Button', uiElementsGroup: 'settings:edit' },
  { name: 'Delete API Button', uiElementsGroup: 'settings:delete' },
  { name: 'Add Page Button', uiElementsGroup: 'settings:edit' },
  { name: 'Delete Page Button', uiElementsGroup: 'settings:delete' },
  { name: 'Add Element Button', uiElementsGroup: 'settings:edit' },
  { name: 'Delete Element Button', uiElementsGroup: 'settings:delete' },
  { name: 'Add Menu Button', uiElementsGroup: 'settings:edit' },
  { name: 'Delete Menu Button', uiElementsGroup: 'settings:delete' },
  { name: 'Add Tenant Button', uiElementsGroup: 'tenants:edit' },
  { name: 'Delete Tenant Button', uiElementsGroup: 'tenants:delete' },
  { name: 'Assign User Tenant', uiElementsGroup: 'tenants:edit' },
];

exports.seed = async function(knex) {
  for (var i = 0; i < ELEMENTS.length; i++) {
    var el = ELEMENTS[i];
    var exists = await knex('uiElements').where({ name: el.name }).first();
    if (!exists) {
      await knex('uiElements').insert({
        id: generateId(),
        name: el.name,
        uiElementsGroup: el.uiElementsGroup,
        isActive: true,
        recordCreatedDate: now,
        recordModifiedDate: now,
        mtId1: MT_ALL
      });
    }
  }
};

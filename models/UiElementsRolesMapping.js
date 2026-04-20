const { BaseModel } = require('@xeplr/db');

class UiElementsRolesMapping extends BaseModel {
  static get tableName() { return 'uiElementsRolesMapping'; }
  static get idColumn() { return 'id'; }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', maxLength: 25 },
        roleId: { type: ['string', 'null'], maxLength: 25 },
        uiElementId: { type: ['string', 'null'], maxLength: 25 },
        recordCreatedDate: { type: ['string', 'null'] },
        recordModifiedDate: { type: ['string', 'null'] },
        recordCreatedBy: { type: ['string', 'null'], maxLength: 25 },
        recordModifiedBy: { type: ['string', 'null'], maxLength: 25 },
        isActive: { type: 'boolean' },
        mtId1: { type: ['string', 'null'], maxLength: 25 },
        mtId2: { type: ['string', 'null'], maxLength: 25 },
        mtId3: { type: ['string', 'null'], maxLength: 25 },
        mtId4: { type: ['string', 'null'], maxLength: 25 }
      }
    };
  }
}

module.exports = UiElementsRolesMapping;

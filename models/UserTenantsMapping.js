const { BaseModel } = require('@xeplr/db');

class UserTenantsMapping extends BaseModel {
  static get multiTenant() { return false; }
  static get tableName() { return 'userTenantsMapping'; }
  static get idColumn() { return 'id'; }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['id', 'userId', 'tenantId'],
      properties: {
        id: { type: 'string', maxLength: 25 },
        userId: { type: 'string', maxLength: 25 },
        tenantId: { type: 'string', maxLength: 25 },
        mtId1: { type: ['string', 'null'], maxLength: 25 },
        mtId2: { type: ['string', 'null'], maxLength: 25 },
        mtId3: { type: ['string', 'null'], maxLength: 25 },
        mtId4: { type: ['string', 'null'], maxLength: 25 },
        isActive: { type: 'boolean' },
        recordCreatedDate: { type: ['string', 'null'] },
        recordModifiedDate: { type: ['string', 'null'] },
        recordCreatedBy: { type: ['string', 'null'], maxLength: 25 },
        recordModifiedBy: { type: ['string', 'null'], maxLength: 25 }
      }
    };
  }
}

module.exports = UserTenantsMapping;

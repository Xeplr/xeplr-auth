const { BaseModel } = require('@xeplr/db');

class ApisRolesMapping extends BaseModel {
  static get tableName() { return 'apisRolesMapping'; }
  static get idColumn() { return 'id'; }

  // Shared RBAC catalog, not per-tenant data — see Role.js for why.
  static get multiTenant() { return false; }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', maxLength: 25 },
        roleId: { type: ['string', 'null'], maxLength: 25 },
        apiId: { type: ['string', 'null'], maxLength: 25 },
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

module.exports = ApisRolesMapping;

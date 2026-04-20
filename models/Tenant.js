const { BaseModel } = require('@xeplr/db');

class Tenant extends BaseModel {
  static get tableName() {
    return 'tenants';
  }

  static get idColumn() {
    return 'id';
  }

  // Tenants are global — not filtered by tenant context
  static get multiTenant() {
    return false;
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string', maxLength: 25 },
        name: { type: 'string', maxLength: 255 },
        code: { type: ['string', 'null'], maxLength: 50 },
        level: { type: 'integer' },
        parentId: { type: ['string', 'null'], maxLength: 25 },
        description: { type: ['string', 'null'], maxLength: 500 },
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

  static get relationMappings() {
    return {
      children: {
        relation: BaseModel.HasManyRelation,
        modelClass: Tenant,
        join: {
          from: 'tenants.id',
          to: 'tenants.parentId'
        }
      },
      parent: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Tenant,
        join: {
          from: 'tenants.parentId',
          to: 'tenants.id'
        }
      }
    };
  }
}

module.exports = Tenant;

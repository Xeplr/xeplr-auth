const { BaseModel } = require('@xeplr/db');

class Api extends BaseModel {
  static get tableName() { return 'apis'; }
  static get idColumn() { return 'id'; }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', maxLength: 25 },
        name: { type: ['string', 'null'], maxLength: 255 },
        apiGroup: { type: ['string', 'null'], maxLength: 255 },
        isPublic: { type: 'integer' },
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

  static get relationMappings() {
    const Role = require('./Role');
    return {
      roles: {
        relation: BaseModel.ManyToManyRelation,
        modelClass: Role,
        join: {
          from: 'apis.id',
          through: { from: 'apisRolesMapping.apiId', to: 'apisRolesMapping.roleId' },
          to: 'roles.id'
        }
      }
    };
  }
}

module.exports = Api;

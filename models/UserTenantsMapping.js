const { BaseModel } = require('@xeplr/db');

class UserTenantsMapping extends BaseModel {
  static get multiTenant() { return false; }
  static get tableName() { return 'userTenantsMapping'; }
  static get idColumn() { return 'id'; }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['id', 'userId', 'level', 'value'],
      properties: {
        id: { type: 'string', maxLength: 25 },
        userId: { type: 'string', maxLength: 25 },
        // Generic MT slot (l1-l4, matching mtId1-4) — NOT the app-defined name
        // (companyId/workspaceId/...); that mapping lives only in the app's
        // own registerMTs() config (see @xeplr/db BaseModel.registerMTs).
        level: { type: 'string', enum: ['l1', 'l2', 'l3', 'l4'] },
        value: { type: 'string', maxLength: 255 },   // the app's own id at that level
        roleId: { type: ['string', 'null'], maxLength: 25 },   // scoped role for this grant (null = access only)
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
    const Role = require('./Role');
    return {
      // no `tenant` relation on purpose: auth does not own a tenant tree,
      // `value` is a bare, app-interpreted id at the given level.
      role: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Role,
        join: { from: 'userTenantsMapping.roleId', to: 'roles.id' }
      }
    };
  }
}

module.exports = UserTenantsMapping;

const { BaseModel } = require('@xeplr/db');

class User extends BaseModel {
  static get multiTenant() { return false; }
  static get tableName() {
    return 'users';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['id', 'email'],
      properties: {
        id: { type: 'string', maxLength: 25 },
        email: { type: 'string', maxLength: 255 },
        phoneNumber: { type: ['string', 'null'], maxLength: 255 },
        name: { type: ['string', 'null'], maxLength: 255 },
        pwd: { type: ['string', 'null'], maxLength: 255 },
        pwdSalt: { type: ['string', 'null'], maxLength: 100 },
        isActive: { type: 'boolean' },
        mtId1: { type: ['string', 'null'], maxLength: 25 },
        mtId2: { type: ['string', 'null'], maxLength: 25 },
        mtId3: { type: ['string', 'null'], maxLength: 25 },
        mtId4: { type: ['string', 'null'], maxLength: 25 },
        isActivated: { type: 'boolean' },
        activatedOn: { type: ['string', 'null'] },
        activatedBy: { type: ['string', 'null'], maxLength: 25 },
        recordCreatedDate: { type: ['string', 'null'] },
        recordModifiedDate: { type: ['string', 'null'] },
        recordCreatedBy: { type: ['string', 'null'], maxLength: 25 },
        recordModifiedBy: { type: ['string', 'null'], maxLength: 25 },
        resetToken: { type: ['string', 'null'], maxLength: 255 },
        resetTokenExpiry: { type: ['string', 'null'] },
        activationToken: { type: ['string', 'null'], maxLength: 255 },
        normalizedEmail: { type: ['string', 'null'], maxLength: 255 }
      }
    };
  }

  static get relationMappings() {
    const Role = require('./Role');
    const Tenant = require('./Tenant');
    return {
      roles: {
        relation: BaseModel.ManyToManyRelation,
        modelClass: Role,
        join: {
          from: 'users.id',
          through: {
            from: 'userRolesMapping.userId',
            to: 'userRolesMapping.roleId'
          },
          to: 'roles.id'
        }
      },
      tenants: {
        relation: BaseModel.ManyToManyRelation,
        modelClass: Tenant,
        join: {
          from: 'users.id',
          through: {
            from: 'userTenantsMapping.userId',
            to: 'userTenantsMapping.tenantId'
          },
          to: 'tenants.id'
        }
      }
    };
  }
}

module.exports = User;

const { BaseModel } = require('@xeplr/db');

class Role extends BaseModel {
  static get tableName() {
    return 'roles';
  }

  static get idColumn() {
    return 'id';
  }

  // Shared RBAC catalog (role definitions), not per-tenant data — tenant
  // scoping happens on userTenantsMapping.roleId, not here. Must opt out:
  // a brand-new user creating their first company has no MT context yet, and
  // BaseModel's fail-closed tenant modifier would otherwise return zero rows.
  static get multiTenant() {
    return false;
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', maxLength: 25 },
        name: { type: ['string', 'null'], maxLength: 255 },
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
    const User = require('./User');
    const Api = require('./Api');
    const UiPage = require('./UiPage');
    const UiElement = require('./UiElement');
    const Menu = require('./Menu');

    return {
      users: {
        relation: BaseModel.ManyToManyRelation,
        modelClass: User,
        join: {
          from: 'roles.id',
          through: { from: 'userRolesMapping.roleId', to: 'userRolesMapping.userId' },
          to: 'users.id'
        }
      },
      apis: {
        relation: BaseModel.ManyToManyRelation,
        modelClass: Api,
        join: {
          from: 'roles.id',
          through: { from: 'apisRolesMapping.roleId', to: 'apisRolesMapping.apiId' },
          to: 'apis.id'
        }
      },
      uiPages: {
        relation: BaseModel.ManyToManyRelation,
        modelClass: UiPage,
        join: {
          from: 'roles.id',
          through: { from: 'uiPagesRolesMapping.roleId', to: 'uiPagesRolesMapping.uiPageId' },
          to: 'uiPages.id'
        }
      },
      uiElements: {
        relation: BaseModel.ManyToManyRelation,
        modelClass: UiElement,
        join: {
          from: 'roles.id',
          through: { from: 'uiElementsRolesMapping.roleId', to: 'uiElementsRolesMapping.uiElementId' },
          to: 'uiElements.id'
        }
      },
      menus: {
        relation: BaseModel.ManyToManyRelation,
        modelClass: Menu,
        join: {
          from: 'roles.id',
          through: { from: 'menuRolesMapping.roleId', to: 'menuRolesMapping.menuId' },
          to: 'menus.id'
        }
      }
    };
  }
}

module.exports = Role;

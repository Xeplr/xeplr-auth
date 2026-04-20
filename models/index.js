const User = require('./User');
const Menu = require('./Menu');
const Api = require('./Api');
const UiPage = require('./UiPage');
const UiElement = require('./UiElement');
const Role = require('./Role');
const ApisRolesMapping = require('./ApisRolesMapping');
const UiPagesRolesMapping = require('./UiPagesRolesMapping');
const UiElementsRolesMapping = require('./UiElementsRolesMapping');
const MenuRolesMapping = require('./MenuRolesMapping');
const UserRolesMapping = require('./UserRolesMapping');
const Tenant = require('./Tenant');
const UserTenantsMapping = require('./UserTenantsMapping');

module.exports = {
  User,
  Menu,
  Api,
  UiPage,
  UiElement,
  Role,
  ApisRolesMapping,
  UiPagesRolesMapping,
  UiElementsRolesMapping,
  MenuRolesMapping,
  UserRolesMapping,
  Tenant,
  UserTenantsMapping
};

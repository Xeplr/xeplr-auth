const { cache } = require('@xeplr/utils');
const User = require('../models/User');
const Api = require('../models/Api');
const UiPage = require('../models/UiPage');
const Menu = require('../models/Menu');
const UiElement = require('../models/UiElement');

// Cache TTLs (seconds)
const USER_ACCESS_TTL = 300;    // 5 min — user's full access object
const API_RULES_TTL = 600;      // 10 min — api public/role data (changes rarely)

// Cache key helpers
const userAccessKey = (userId) => `access:user:${userId}`;
const apiRulesKey = (apiName) => `access:api:${encodeURIComponent(apiName)}`;
const publicItemsKey = 'access:public';

/**
 * Fetch the full access object for a user.
 * Cached in Redis. Use clearUserAccess() to invalidate.
 */
async function getUserAccess(userId) {
  // Check cache first
  const cached = await cache.get(userAccessKey(userId));
  if (cached) return cached;

  const user = await User.query()
    .findById(userId)
    .withGraphFetched('roles.[apis, uiPages, uiElements, menus]');

  if (!user || !user.roles) {
    const empty = { roles: [], pages: [], apis: [], menus: [], elements: [] };
    await cache.set(userAccessKey(userId), empty, USER_ACCESS_TTL);
    return empty;
  }

  const roleNames = new Set();
  const pages = new Set();
  const apis = new Set();
  const menus = new Set();
  const elements = new Set();

  for (const role of user.roles) {
    roleNames.add(role.name);

    if (role.apis) {
      for (const api of role.apis) apis.add(api.name);
    }
    if (role.uiPages) {
      for (const page of role.uiPages) pages.add(page.name);
    }
    if (role.menus) {
      for (const menu of role.menus) menus.add(menu.name);
    }
    if (role.uiElements) {
      for (const el of role.uiElements) elements.add(el.name);
    }
  }

  // Add public items
  const publicItems = await getPublicItems();
  for (const api of publicItems.apis) apis.add(api);
  for (const page of publicItems.pages) pages.add(page);
  for (const menu of publicItems.menus) menus.add(menu);

  const access = {
    roles: [...roleNames],
    pages: [...pages],
    apis: [...apis],
    menus: [...menus],
    elements: [...elements]
  };

  await cache.set(userAccessKey(userId), access, USER_ACCESS_TTL);
  return access;
}

/**
 * Get all public items (cached separately, shared across users).
 */
async function getPublicItems() {
  const cached = await cache.get(publicItemsKey);
  if (cached) return cached;

  const [publicApis, publicPages, publicMenus] = await Promise.all([
    Api.query().where({ isPublic: 1 }),
    UiPage.query().where({ isPublic: 1 }),
    Menu.query().where({ isPublic: 1 })
  ]);

  const result = {
    apis: publicApis.map(a => a.name),
    pages: publicPages.map(p => p.name),
    menus: publicMenus.map(m => m.name)
  };

  await cache.set(publicItemsKey, result, API_RULES_TTL);
  return result;
}

/**
 * Get cached API rule (public flag + role IDs).
 * Avoids repeated DB lookups in middleware.
 */
async function getApiRule(apiName) {
  const cacheKey = apiRulesKey(apiName);
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const api = await Api.query()
    .findOne({ name: apiName })
    .withGraphFetched('roles');

  if (!api) {
    // Not registered = open
    const rule = { exists: false, isPublic: true, roleIds: [] };
    await cache.set(cacheKey, rule, API_RULES_TTL);
    return rule;
  }

  const roleIds = (api.roles || []).map(r => r.id);
  const rule = {
    exists: true,
    isPublic: !!api.isPublic,
    unmapped: roleIds.length === 0,
    roleIds
  };

  await cache.set(cacheKey, rule, API_RULES_TTL);
  return rule;
}

/**
 * Check if a user has access to a specific API.
 * Uses cached API rules and cached user roles.
 */
async function userHasApiAccess(userId, apiName) {
  const rule = await getApiRule(apiName);

  // Not registered in DB, or marked public, or no role mappings = open
  if (!rule.exists || rule.isPublic || rule.unmapped) return true;

  // Get user's role IDs (from user access cache)
  const userRoleCacheKey = `access:userRoles:${userId}`;
  let userRoleIds = await cache.get(userRoleCacheKey);

  if (!userRoleIds) {
    const user = await User.query()
      .findById(userId)
      .withGraphFetched('roles');

    userRoleIds = (user && user.roles) ? user.roles.map(r => r.id) : [];
    await cache.set(userRoleCacheKey, userRoleIds, USER_ACCESS_TTL);
  }

  const userRoleSet = new Set(userRoleIds);
  return rule.roleIds.some(id => userRoleSet.has(id));
}

/**
 * Clear all cached access data for a user.
 * Call this on login so the user gets fresh permissions.
 */
async function clearUserAccess(userId) {
  await Promise.all([
    cache.del(userAccessKey(userId)),
    cache.del(`access:userRoles:${userId}`)
  ]);
}

/**
 * Clear all cached API rules and public items.
 * Call this when you modify role mappings, isPublic flags, etc.
 */
async function clearAccessRules() {
  await Promise.all([
    cache.del(publicItemsKey),
    cache.delPattern('access:api:*')
  ]);
}

module.exports = {
  getUserAccess,
  userHasApiAccess,
  clearUserAccess,
  clearAccessRules,
  getApiRule,
  getPublicItems
};

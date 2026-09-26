const { cache } = require('@xeplr/utils');
const User = require('../models/User');
const Api = require('../models/Api');
const UiPage = require('../models/UiPage');
const Menu = require('../models/Menu');
const UiElement = require('../models/UiElement');
const { visibleItems } = require('./menuService');
const { matchApi } = require('./apiMatch');

// Cache TTLs (seconds)
const USER_ACCESS_TTL = 300;    // 5 min — user's full access object
const API_RULES_TTL = 600;      // 10 min — api public/role data (changes rarely)

// Cache key helpers
const userAccessKey = (userId) => `access:user:${userId}`;
const apiRulesKey = (apiName) => `access:api:${encodeURIComponent(apiName)}`;
const publicItemsKey = 'access:public';
const catalogKey = 'access:api:catalog';   // under access:api:*, so clearAccessRules() clears it

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
    const empty = { roles: [], pages: [], apis: [], menus: [], menuItems: [], elements: [] };
    await cache.set(userAccessKey(userId), empty, USER_ACCESS_TTL);
    return empty;
  }

  const roleNames = new Set();
  const pages = new Set();
  const apis = new Set();
  const menuRows = [];
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
      for (const menu of role.menus) menuRows.push(menu);
    }
    if (role.uiElements) {
      for (const el of role.uiElements) elements.add(el.name);
    }
  }

  // Add public items
  const publicItems = await getPublicItems();
  for (const api of publicItems.apis) apis.add(api);
  for (const page of publicItems.pages) pages.add(page);
  // Rows, not just names: a hidden item is left out, and each keeps its label
  // and position. Caches written before labels existed carry names only.
  for (const menu of publicItems.menuItems || publicItems.menus.map((name) => ({ name }))) menuRows.push(menu);
  const menuItems = visibleItems(menuRows);

  const access = {
    roles: [...roleNames],
    pages: [...pages],
    apis: [...apis],
    // KEYS — what the app's drawerItems / settingsOverrides match on.
    menus: menuItems.map((m) => m.name),
    // What to SHOW for each key, in rail order: [{ name, label, sortOrder }].
    menuItems,
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
    menus: publicMenus.filter(m => !m.isHidden).map(m => m.name),
    menuItems: publicMenus.map(m => ({ name: m.name, label: m.label || null, sortOrder: m.sortOrder === undefined ? null : m.sortOrder, isHidden: !!m.isHidden }))
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
 * Access states. A gate answers one of these, not true/false:
 *
 *   enabled    shown and usable
 *   disabled   shown, greyed out, not usable: the API refuses it
 *   hidden     not shown: the API refuses it
 *
 * Today only enabled and hidden can come out (a role mapping is there or it
 * is not). disabled is part of the answer so callers handle it now; the
 * stored states that produce it come next.
 */
var ACCESS_STATES = ['enabled', 'disabled', 'hidden'];

/**
 * The state for an API rule and a user's role ids. Pure, so it can be tested
 * without a database.
 */
function apiStateFor(rule, userRoleIds) {
  // Not registered in DB, or marked public, or no role mappings = open
  if (!rule.exists || rule.isPublic || rule.unmapped) return 'enabled';
  var userRoleSet = new Set(userRoleIds || []);
  return rule.roleIds.some(function(id) { return userRoleSet.has(id); }) ? 'enabled' : 'hidden';
}

/** The user's role ids, cached for the gate. */
async function userRoleIdsOf(userId) {
  var userRoleCacheKey = `access:userRoles:${userId}`;
  var userRoleIds = await cache.get(userRoleCacheKey);
  if (userRoleIds) return userRoleIds;

  var user = await User.query()
    .findById(userId)
    .withGraphFetched('roles');

  userRoleIds = (user && user.roles) ? user.roles.map(function(r) { return r.id; }) : [];
  await cache.set(userRoleCacheKey, userRoleIds, USER_ACCESS_TTL);
  return userRoleIds;
}

/**
 * A user's state for a specific API: 'enabled' | 'disabled' | 'hidden'.
 * Uses cached API rules and cached user roles.
 */
async function userApiState(userId, apiName) {
  var rule = await getApiRule(apiName);
  if (!rule.exists || rule.isPublic || rule.unmapped) return 'enabled';
  return apiStateFor(rule, await userRoleIdsOf(userId));
}

/** Every API name in the catalog, cached like the other access rules. */
async function catalogApiNames() {
  var cached = await cache.get(catalogKey);
  if (Array.isArray(cached)) return cached;
  var rows = await Api.query().select('name');
  var names = rows.map(function(r) { return r.name; });
  await cache.set(catalogKey, names, API_RULES_TTL);
  return names;
}

/**
 * A user's state for a REQUEST: the catalog row it matches (method, path,
 * :params), then that row's state. Not registered → enabled (open).
 *
 * @returns { api, state }   api is the matched name, or null
 */
async function requestApiState(userId, method, path) {
  var api = matchApi(await catalogApiNames(), method, path);
  if (!api) return { api: null, state: 'enabled' };
  return { api: api, state: await userApiState(userId, api) };
}

/** True only when the state is enabled. Kept for callers that want a yes/no. */
async function userHasApiAccess(userId, apiName) {
  return (await userApiState(userId, apiName)) === 'enabled';
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

/** Every cached access answer — after the catalog itself changes (a menu renamed, added, hidden). */
async function clearAllAccess() {
  await Promise.all([
    clearAccessRules(),
    cache.delPattern('access:user:*')
  ]);
}

module.exports = {
  ACCESS_STATES,
  apiStateFor,
  clearAllAccess,
  getUserAccess,
  requestApiState,
  userApiState,
  userHasApiAccess,
  clearUserAccess,
  clearAccessRules,
  getApiRule,
  getPublicItems
};

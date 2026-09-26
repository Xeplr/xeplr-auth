/**
 * System scope — what only Super Admin may reach, see or hand out.
 *
 * An `apis` row with `scope = 'system'` is a system API: this guard refuses it
 * to anyone who is not Super Admin, whatever the role mappings say. A product
 * registers its own system APIs from its migrations (insert the row with
 * scope 'system') and mounts systemScopeGuard() in front of its routes; no
 * code change here. See migrations/0010_system_scope.sql.
 *
 * A row's name is either a path, which covers every method, or
 * "METHOD path", which covers that method only — so GET can stay open on a
 * path whose POST is a system action.
 */
var { cache } = require('@xeplr/utils');
var Api = require('../models/Api');

var SUPER_ADMIN_ROLE = 'Super Admin';
var CACHE_KEY = 'access:api:system';   // under access:api:*, so clearAccessRules() clears it
var CACHE_TTL = 600;

/** Does this signed-in user hold Super Admin? (req.user.roles are names, from the token.) */
function isSuperAdmin(user) {
  var roles = (user && user.roles) || [];
  return roles.indexOf(SUPER_ADMIN_ROLE) !== -1;
}

/** The names of every system API, cached like the other access rules. */
async function systemApiNames() {
  var cached = await cache.get(CACHE_KEY);
  if (Array.isArray(cached)) return cached;
  var rows = await Api.query().select('name').where('scope', 'system');
  var names = rows.map(function(r) { return r.name; });
  await cache.set(CACHE_KEY, names, CACHE_TTL);
  return names;
}

/**
 * Is this request a system API? Pure, so it can be tested without a request.
 *
 * @param names   system API names ("path" or "METHOD path")
 * @param method  'GET', 'POST', …
 * @param path    the full path, e.g. req.baseUrl + req.path
 */
function isSystemRequest(names, method, path) {
  var clean = String(path || '').replace(/\/+$/, '') || '/';
  var withMethod = String(method || '').toUpperCase() + ' ' + clean;
  return names.some(function(n) {
    var name = String(n || '').replace(/\/+$/, '');
    return name === clean || name === withMethod;
  });
}

/**
 * Express middleware: refuse system APIs to anyone but Super Admin.
 * Mount after the auth check, so req.user is set.
 *
 * Fails CLOSED: if the catalog cannot be read, a request is refused rather
 * than let through, because "cannot tell if this is a system action" must
 * never mean "allowed".
 */
function systemScopeGuard() {
  return async function(req, res, next) {
    var path = (req.baseUrl || '') + (req.path || '');
    var names;
    try { names = await systemApiNames(); }
    catch (err) { return res.status(503).json({ error: 'Access rules are unavailable; try again shortly' }); }
    if (!isSystemRequest(names, req.method, path)) return next();
    if (isSuperAdmin(req.user)) return next();
    return res.status(403).json({ error: 'This is a system action: only Super Admin can do it', code: 'SYSTEM_SCOPE' });
  };
}

module.exports = {
  SUPER_ADMIN_ROLE: SUPER_ADMIN_ROLE,
  isSuperAdmin: isSuperAdmin,
  isSystemRequest: isSystemRequest,
  systemApiNames: systemApiNames,
  systemScopeGuard: systemScopeGuard
};

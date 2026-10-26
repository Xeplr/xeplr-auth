var { generateId } = require('./authHelper');
var Role = require('../models/Role');
var UserRolesMapping = require('../models/UserRolesMapping');
var { clearUserAccess } = require('./accessService');

/**
 * Give a user roles. Skips any they already hold, then drops their cached
 * access so the next request sees the new roles. The one insert behind both
 * the admin's role toggle and the roles a new account gets on activation.
 *
 * @param {string} userId
 * @param {string[]} roleIds
 * @param {object} [options] - { by: userId doing it, knex: transaction }
 */
async function grantRoles(userId, roleIds, options) {
  var by = options && options.by;
  var knex = options && options.knex;
  var Mapping = knex ? UserRolesMapping.bindKnex(knex) : UserRolesMapping;
  for (var i = 0; i < roleIds.length; i++) {
    var existing = await Mapping.query().findOne({ userId: userId, roleId: roleIds[i] });
    if (existing) continue;
    await Mapping.query().insert({
      id: generateId(),
      userId: userId,
      roleId: roleIds[i],
      recordCreatedBy: by || null
    });
  }
  await clearUserAccess(userId);
}

// THE ROLES A SELF-REGISTERED ACCOUNT GETS — named by each app, never assumed.
//
// Without a role every API mapped to roles is hidden from the person, their
// own profile included, so an account with none can sign in and do nothing.
// Which role fits is the app's call (BI: Viewer), so there is no default:
// registration refuses until AUTH_REGISTER_ROLES names one, rather than
// quietly creating accounts that cannot use the app.
//
// Read at call time, like AUTH_ACTIVATION_URL, so the .env the app has
// loaded is the one used. System roles (Super Admin) are refused: a sign-up
// form must never be a way to become one.
var REGISTER_ROLES_VAR = 'AUTH_REGISTER_ROLES';

function refusal(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

async function registerRoleIds(knex) {
  var raw = process.env[REGISTER_ROLES_VAR];
  var names = String(raw || '').split(',')
    .map(function(n) { return n.trim(); })
    .filter(Boolean);
  if (!names.length) {
    throw refusal('REGISTER_ROLES_NOT_SET', REGISTER_ROLES_VAR + ' is not set: name the role(s) a new ' +
      'account gets, comma-separated (for example Viewer). Registration is refused until it is.');
  }

  var RoleM = knex ? Role.bindKnex(knex) : Role;
  var roles = await RoleM.query().select('id', 'name', 'scope').where('mtId1', '*').whereIn('name', names);
  var missing = names.filter(function(n) { return !roles.some(function(r) { return r.name === n; }); });
  if (missing.length) {
    throw refusal('REGISTER_ROLES_UNKNOWN', REGISTER_ROLES_VAR + ' names ' +
      (missing.length > 1 ? 'roles that do' : 'a role that does') + ' not exist: ' + missing.join(', ') + '.');
  }
  var system = roles.filter(function(r) { return r.scope === 'system'; });
  if (system.length) {
    throw refusal('REGISTER_ROLES_SYSTEM', REGISTER_ROLES_VAR + ' names a system role (' +
      system.map(function(r) { return r.name; }).join(', ') + '); new accounts can never be given one.');
  }
  return roles.map(function(r) { return r.id; });
}

module.exports = { grantRoles, registerRoleIds, refusal, REGISTER_ROLES_VAR };

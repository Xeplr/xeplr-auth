// WHICH SOLD MODULES A USER MAY USE.
//
// Every catalog row (apis, menus, uiPages, uiElements) carries a licenseModule
// (0007): 'core' for sign-in and everything that belongs to no product, or the
// product it was sold as ('bi', 'warehouse', 'xflow', ...). Roles say what a
// user's job lets them do; this says what was paid for. Access is both.
//
// What was paid for is the host app's to say, not this library's: an
// on-premises install reads it from its signed licence, a SaaS app from its
// billing. So the host registers one function, in the auth process (the same
// file that calls boot(), as for hooks):
//
//   require('@xeplr/auth').licence.use({
//     modulesFor: async function(userId) { return ['bi', 'warehouse']; }
//   });
//
// Nothing registered: no filtering at all, as before this existed. 'core' is
// always allowed, whatever the function answers: a user who cannot sign in
// cannot be told they are unlicensed.
//
// The answer is folded into the user's cached access (5 minutes), so a seat
// given or taken reaches the user within that, or at once after
// clearUserAccess(userId).

var CORE = 'core';
var _modulesFor = null;

function use(options) {
  var fn = options && options.modulesFor;
  if (fn !== undefined && fn !== null && typeof fn !== 'function') throw new Error('licence.use: modulesFor must be a function');
  _modulesFor = fn || null;
}

/** The Set of modules this user may use, or null when no host registered one (everything allowed). */
async function modulesFor(userId) {
  if (!_modulesFor) return null;
  var modules = new Set((await _modulesFor(userId)) || []);
  modules.add(CORE);
  return modules;
}

/** Is a row of this licenseModule allowed under these modules? */
function allows(modules, licenseModule) {
  return !modules || modules.has(licenseModule || CORE);
}

module.exports = { use: use, modulesFor: modulesFor, allows: allows, CORE: CORE };

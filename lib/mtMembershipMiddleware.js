const { getMtConfig } = require('@xeplr/db');
const UserTenantsMapping = require('../models/UserTenantsMapping');
const { isSuperAdmin } = require('./systemScope');

var SLOT_KEYS = ['l1', 'l2', 'l3', 'l4'];

/**
 * Rejects a request whose MT header values don't match a real membership
 * grant for the caller — mtMiddleware (in @xeplr/db) trusts any header value
 * to filter/stamp rows, this is what actually checks the caller is allowed to
 * use it. Mount AFTER authMiddleware (needs req.user.id) and AFTER
 * @xeplr/db's mtMiddleware() (reads the same headers).
 *
 * Super Admin passes whatever the headers say: the role runs the whole
 * install, so it is a member of every company by definition.
 *
 * A header that's simply absent is left alone — the existing fail-closed
 * query modifier in BaseModel already handles "missing" (empty result set).
 * This only rejects a PRESENT but unauthorized value (403).
 *
 * @param {object} [options]
 * @param {typeof UserTenantsMapping} [options.userTenantsMapping] - a bound
 *   model class, e.g. `auth.attach().model('UserTenantsMapping')` when auth
 *   runs as its own standalone service. Omit if you called auth.init() in
 *   this same process (Model.knex is already globally bound there).
 *
 *   var { mtMembershipMiddleware } = require('@xeplr/auth');
 *   app.use(mtMiddleware());               // @xeplr/db — sets mtId context
 *   app.use(mtMembershipMiddleware());     // this — rejects forged values
 */
function mtMembershipMiddleware(options) {
  options = options || {};
  var Model = options.userTenantsMapping || UserTenantsMapping;

  return async function(req, res, next) {
    try {
      var mtConfig = getMtConfig();
      if (!mtConfig.enabled || !req.user || !req.user.id) return next();
      // Super Admin goes into any company and workspace: running the whole
      // install is the role. Everyone else needs a membership row per value.
      if (isSuperAdmin(req.user)) return next();

      for (var i = 0; i < SLOT_KEYS.length; i++) {
        var key = SLOT_KEYS[i];
        var slot = mtConfig.slots[key];
        if (!slot) continue;

        var value = req.headers[slot.header];
        if (!value) continue;

        var grant = await Model.query()
          .where({ userId: req.user.id, level: key, value: value, isActive: true })
          .first();

        if (!grant) {
          return res.status(403).json({ error: 'Not authorized for ' + (slot.name || key) + ' "' + value + '"' });
        }
      }

      next();
    } catch (err) {
      if (req.log) req.log.error(err.message, { stack: err.stack });
      res.status(500).json({ error: 'Something went wrong' });
    }
  };
}

module.exports = mtMembershipMiddleware;

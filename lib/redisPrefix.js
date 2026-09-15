/**
 * REDIS_PREFIX — the namespace every auth key is written under: sessions, the
 * token whitelist, and the access cache. Required, and never the old shared
 * default.
 *
 * WHY IT IS NOT DEFAULTED. @xeplr/utils' cache falls back to 'xeplr:', so two
 * apps on one Redis (every developer machine running more than one of them)
 * read and write the same keys. Most of those keys carry a token or a random
 * user id and so never meet, but the access cache has keys named by content:
 *
 *   access:public        the menus/pages everyone may see
 *   access:api:<name>    whether an API is open, and to which roles
 *
 * One app fills them from ITS database and the other serves them as its own.
 * The visible half is a drawer showing another product's menus and dropping
 * its own. The half nobody sees is worse: an API the other app has never
 * registered is cached as "open to everyone", so a guarded route — publishing
 * a screen, which alters tables — answers any signed-in caller for up to ten
 * minutes. No error, no log line.
 *
 * 'xeplr:' is refused even when written out explicitly: it is exactly the
 * value an env file copied from another project would carry, and accepting it
 * would bring the collision back looking deliberate.
 *
 * @param {object} [env=process.env]
 * @returns {string} the prefix to use
 * @throws {Error} naming REDIS_PREFIX when it is missing or the shared default
 */
var SHARED_DEFAULT = 'xeplr:';

function redisPrefix(env) {
  env = env || process.env;
  var value = (env.REDIS_PREFIX || '').trim();

  if (!value) {
    throw new Error('REDIS_PREFIX is not set. Give this app its own, e.g. REDIS_PREFIX=myapp: — ' +
      'apps sharing a Redis without one serve each other\'s sessions, menus and API permissions.');
  }
  if (value === SHARED_DEFAULT) {
    throw new Error('REDIS_PREFIX is "' + SHARED_DEFAULT + '", the value every app shares by default. ' +
      'Give this app its own, e.g. REDIS_PREFIX=myapp:');
  }
  return value;
}

module.exports = { redisPrefix: redisPrefix, SHARED_DEFAULT: SHARED_DEFAULT };

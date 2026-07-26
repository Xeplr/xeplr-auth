// One generic hook dispatcher for the whole library. Every mutating operation
// in xeplr-auth (register, activate, role CRUD, mapping toggles, master CRUD,
// ...) fires through here, tagged with an identifier ('user', 'roles', 'apis',
// 'uiPages', 'uiElements', 'menus', 'userRolesMapping', ...) and a fixed event
// ('create' | 'update' | 'delete', plus 'login' — not a CRUD event, but kept
// on 'user' since it's a meaningful lifecycle moment too).
//
// The identifiers are internal to the library (see the fire() call sites for
// the authoritative list) — you don't need a pre-built namespace object to use
// one, just the string, documented here and at each call site:
//   require('@xeplr/auth').hooks.on('user', 'create', function(id) { ... });
//   require('@xeplr/auth').hooks.on('roles', 'create', function(id) { ... });
//
// One handler per (identifier, event) — registering again REPLACES the
// previous one, not an accumulating list. No handler registered = silent
// no-op. A failing handler is caught + logged, never breaks the operation
// that fired it.
//
// setHooksEnabled(false) is a bulk kill-switch (e.g. for tests) — defaults to
// enabled (AUTH_ENABLE_HOOKS=false to default it off via env instead).
//
// NOTE on process boundaries: auth normally runs as its own service (AUTH_PORT),
// a separate process from your app's API. A hook registered from the API
// process is never seen here — register()/login()/etc. run in the auth
// service's own process. Assign hooks in the SAME script that calls boot():
// write your own tiny boot file (copy bin/server.js) that does
//   require('@xeplr/auth').hooks.on('user', 'create', fn);
//   require('@xeplr/auth').boot();
// and point your start-auth script at that file instead of the packaged bin.

var _enabled = process.env.AUTH_ENABLE_HOOKS !== 'false';
var _handlers = {};

function key(identifier, event) { return identifier + ':' + event; }

function setHooksEnabled(enabled) { _enabled = !!enabled; }

function on(identifier, event, fn) {
  _handlers[key(identifier, event)] = fn;
}

async function fire(identifier, event, id) {
  if (!_enabled) return;
  var fn = _handlers[key(identifier, event)];
  if (!fn) return;
  try { await fn(id); }
  catch (err) { console.error('[xeplr-auth] hook (' + identifier + '.' + event + ') failed:', err.message); }
}

module.exports = { on, fire, setHooksEnabled };

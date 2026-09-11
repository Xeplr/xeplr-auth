const path = require('path');
const { getConnection, bindModels, resolveConfig, sqlMigrator, resolveDbConnection, describeDbConnection, migrationsFor, migrationsVar } = require('@xeplr/db');

// The connection comes from XEPLR_DB_CONNECTION unless this service overrides
// it with AUTH_DB_CONNECTION_INFO_ENCRYPTED — one server, one credential, with
// an escape hatch. AUTH_DB_NAME is untouched: which DATABASE is a separate
// question from where the server is, and auth keeps its own.
var AUTH_CONN_VAR = 'AUTH_DB_CONNECTION_INFO_ENCRYPTED';
function authConnection() { return resolveDbConnection(AUTH_CONN_VAR); }
const { createApp } = require('@xeplr/base-apis');
const authHelper = require('./lib/authHelper');
const { seedSuperAdmin } = require('./lib/seed');
const authMiddleware = require('./lib/authMiddleware');
const authService = require('./lib/authService');
const accessService = require('./lib/accessService');
const { accessMiddleware, requireRole } = require('./lib/accessMiddleware');
const sessionService = require('./lib/sessionService');
const ticketService = require('./lib/ticketService');
const hooks = require('./lib/hooks');
const mtMembershipMiddleware = require('./lib/mtMembershipMiddleware');
const createAuthRouter = require('./lib/authRouter');
const createAdminRouter = require('./lib/adminRouter');
const models = require('./models');

let _initialized = false;

/**
 * Initialize xeplr-auth.
 *
 * @param {object} config
 * @param {string} config.database - Database name for auth tables
 * @param {object} [config.db] - DB connection options { host, user, password, port }
 * @param {object} [config.jwt] - JWT options { secret, expiresIn }
 * @param {object} [config.email] - Email config { provider, smtp, aws, azure, brevo }
 * @param {string} [config.resetBaseUrl] - Base URL for password reset links
 */
async function init(config = {}) {
  // One call: decrypt the app-supplied connection, connect, and bind the models.
  const dbName = config.database || process.env.AUTH_DB_NAME || 'auth';
  const connection = await getConnection(dbName, config.connection || config.db, {
    connectionName: config.connectionName || 'auth'
  });

  // Configure JWT
  if (config.jwt) {
    authHelper.configure({
      jwtSecret: config.jwt.secret,
      accessTokenExpiresIn: config.jwt.accessTokenExpiresIn || '15m'
    });
  }

  // Configure email provider
  if (config.email) {
    authService.configureEmail(config.email);
  }

  _initialized = true;

  return connection;
}

/**
 * Get the Express router for auth API endpoints.
 * Must call init() first.
 *
 * @param {object} [options]
 * @param {string} [options.resetBaseUrl] - Override reset password base URL
 */
function router(options = {}) {
  return createAuthRouter(options);
}

function adminRouter() {
  return createAdminRouter();
}

/**
 * Start xeplr-auth as a standalone Express API server.
 * Calls init() internally, then boots Express via xeplr-base-apis.
 *
 * @param {object} config
 * @param {number|string} config.port - Port to listen on (default: AUTH_PORT env or 19001)
 * @param {string} [config.database] - Database name
 * @param {object} [config.db] - DB connection options
 * @param {object} [config.jwt] - JWT options
 * @param {string} [config.emailServiceUrl] - URL of xeplr-email service
 * @param {string} [config.resetBaseUrl] - Base URL for reset links
 * @param {object} [config.corsOptions] - CORS options
 * @param {Function[]} [config.middleware] - Additional middleware
 * @returns {http.Server}
 */
async function start(config = {}) {
  await init(config);

  const port = config.port || process.env.AUTH_PORT || 19001;
  const authRouter = createAuthRouter({ resetBaseUrl: config.resetBaseUrl });
  const adminRtr = createAdminRouter();

  return createApp(port, 'xeplr-auth', {
    // THE ONE SERVICE THAT CANNOT USE createApp's DEFAULT GATE — that gate
    // validates a token by asking the auth service over HTTP, and this IS the
    // auth service. It would be asking itself, and /login has no token to ask
    // with.
    //
    // Not a hole. createAuthRouter gates its own protected routes per-route
    // with authMiddleware (/me, /profile, /change-password, /sse-ticket, and
    // all of /admin). What is left open — login, register, activate, refresh,
    // forgot/reset-password — is open by design, because it is how a caller
    // obtains a token in the first place.
    auth: false,
    corsOptions: config.corsOptions,
    middleware: config.middleware,
    routes: { '/auth/api': authRouter, '/auth/api/admin': adminRtr }
  });
}

/**
 * Boot xeplr-auth as a fully independent service. ENV-DRIVEN — no config; there
 * is always one auth system, so it reads everything from AUTH_* env. Resolves the
 * connection, self-migrates, configures email/jwt/activation, starts the server.
 *
 * @returns {Promise<http.Server>}
 */
// Boot the auth service. ENV-DRIVEN, no config — there is always a single auth
// system, so it reads its whole setup from AUTH_* env (see requiredEnv + README):
//   connection AUTH_DB_CONNECTION_INFO_ENCRYPTED · db AUTH_DB_NAME · AUTH_JWT_SECRET
//   AUTH_PORT · AUTH_ACTIVATION_BASE_URL · AUTH_ACCESS_TOKEN_TTL_MINUTES
//   XEPLR_AUTH_MIGRATIONS · email vars · REDIS_*
/**
 * REDIS HOLDS THE SESSIONS, so this service cannot authenticate anybody
 * without it. Checked here, out loud, because the way this fails otherwise is
 * genuinely cruel:
 *
 *   • login SUCCEEDS — minting a token does not need Redis to work
 *   • the session write fails silently
 *   • every later request finds no live session and answers
 *     "Invalid or expired token"
 *
 * So a brand-new token is rejected as expired, and the message sends whoever
 * is debugging it towards clocks, token lifetimes and JWT secrets — anywhere
 * but the service that is not running. It cost two people an afternoon before
 * this check existed.
 *
 * Refuses rather than warns. An auth service that cannot keep a session is not
 * degraded, it is unable to do the one thing it is for, and starting anyway
 * only moves the failure somewhere less obvious.
 */
async function checkSessionStore() {
  var host = process.env.REDIS_HOST || 'localhost';
  var port = process.env.REDIS_PORT || '6379';
  var probe = '__xeplr_auth_startup_probe__';

  try {
    var { cache } = require('@xeplr/utils');
    await cache.set(probe, { ok: true }, 5);
    var back = await cache.get(probe);
    await cache.del(probe);
    if (!back || !back.ok) throw new Error('the session store did not return what was written to it');
  } catch (err) {
    console.error('\n[xeplr-auth] Cannot reach the session store (Redis) at ' + host + ':' + port + '.');
    console.error('             ' + (err && err.message ? err.message : err) + '\n');
    console.error('  Sign-in sessions are kept there, so without it every login');
    console.error('  succeeds and then every request is refused as "Invalid or');
    console.error('  expired token" — which looks like a token problem and is not.\n');
    console.error('  Start Redis, or point REDIS_HOST / REDIS_PORT at one:\n');
    console.error('    macOS    brew services start redis');
    console.error('    Linux    sudo systemctl start redis');
    console.error('    Windows  docker run -d -p 6379:6379 redis');
    console.error('             (Redis has no native Windows build — Docker or WSL)\n');
    process.exit(1);
  }
}

async function boot() {
  var connName = 'auth';
  var database = process.env.AUTH_DB_NAME || 'auth';

  await checkSessionStore();

  await resolveConfig(connName, authConnection());

  // Self-migrate: auth's own .sql migrations (schema + base data), then the
  // app's extension dir. Idempotent — same as `xeplr-auth-migrate up`.
  var migrationResult = await sqlMigrator.up({
    db: database,
    dir: path.join(__dirname, 'migrations'),
    // The SHARED convention, not this library's own reading of the variable.
    // Passing process.env.XEPLR_AUTH_MIGRATIONS straight through is what
    // broke here: a comma-separated list became one nonexistent directory and
    // this entry point silently applied none of BI's, workflow's or jobs'
    // migrations, while the xeplr-auth-migrate CLI — which had its own
    // splitting — applied all of them. Same variable, two behaviours.
    extDir: migrationsFor('auth'),
    type: 'precede',
    connectionName: connName
  });
  console.log(migrationResult.migrations.length
    ? '[xeplr-auth] ran ' + migrationResult.migrations.length + ' migrations'
    : '[xeplr-auth] migrations up to date');

  // Configure email (via @xeplr/utils, the engine auth uses) + activation links.
  require('@xeplr/utils').configureFromEnv();
  authService.configureActivation({
    // Fully qualified, one per link — the token is the only thing appended.
    // AUTH_ACTIVATION_BASE_URL still works as an origin; see configureActivation.
    activationUrl: process.env.AUTH_ACTIVATION_URL || null,
    inviteUrl: process.env.AUTH_INVITE_URL || null,
    baseUrl: process.env.AUTH_ACTIVATION_BASE_URL || null
  });

  var server = await start({
    database: database,
    connectionName: connName,
    connection: authConnection(),
    port: process.env.AUTH_PORT,
    jwt: {
      secret: process.env.AUTH_JWT_SECRET,
      accessTokenExpiresIn: (process.env.AUTH_ACCESS_TOKEN_TTL_MINUTES || '15') + 'm'
    }
  });

  banner();
  return server;
}

// Startup summary — the EFFECTIVE config (defaults resolved) so you can see what
// the service is actually running with. Secrets are masked, never printed.
function banner() {
  var set = function (v) { return v ? '✓ set' : '✗ MISSING'; };
  var rows = [
    ['port',               process.env.AUTH_PORT || '19001'],
    ['database',           process.env.AUTH_DB_NAME || 'auth'],
    [migrationsVar('auth'), migrationsFor('auth') || '(none)'],
    ['activation url',     process.env.AUTH_ACTIVATION_URL || process.env.AUTH_ACTIVATION_BASE_URL || '(none)'],
    ['invite url',         process.env.AUTH_INVITE_URL || '(derived)'],
    ['access token ttl',   (process.env.AUTH_ACCESS_TOKEN_TTL_MINUTES || '15') + 'm'],
    ['refresh token ttl',  (process.env.AUTH_REFRESH_TOKEN_TTL_DAYS || '7') + 'd'],
    ['slide tolerance',    (process.env.AUTH_ACCESS_TOKEN_TOLERANCE_SECONDS || '0') + 's'],
    ['max sessions/user',  process.env.AUTH_MAX_SESSIONS_PER_USER || '5'],
    ['redis',              (process.env.REDIS_HOST || 'localhost') + ':' + (process.env.REDIS_PORT || '6379')],
    ['email',              process.env.EMAIL_PROVIDER || '(not configured)'],
    // Names the VARIABLE it resolved through, not just "set" — with a shared
    // default and a per-service override, "which server am I on" is otherwise
    // a guess.
    ['connection',         describeDbConnection(AUTH_CONN_VAR) || '✗ NOT CONFIGURED'],
    ['encryption key',     set(process.env.ENCRYPTION_KEY)],
    ['jwt secret',         process.env.AUTH_JWT_SECRET ? '✓ set' : '✗ INSECURE DEFAULT']
  ];
  var lines = rows.map(function (r) { return r[0].padEnd(19) + String(r[1]); });
  var title = 'xeplr-auth · running';
  var inner = Math.max.apply(null, [title.length].concat(lines.map(function (l) { return l.length; }))) + 2;
  var bar = '─'.repeat(inner);
  console.log('\n┌' + bar + '┐');
  console.log('│ ' + title.padEnd(inner - 1) + '│');
  console.log('├' + bar + '┤');
  lines.forEach(function (l) { console.log('│ ' + l.padEnd(inner - 1) + '│'); });
  console.log('└' + bar + '┘\n');
}

/**
 * Attach to the auth database from ANOTHER process (e.g. the api service), so it
 * can act on auth tables — invite users, assign roles. ENV-DRIVEN
 * (AUTH_DB_NAME + AUTH_DB_CONNECTION_INFO_ENCRYPTED). Opens a SECONDARY connection
 * (bind:false, so it never hijacks the api's global model binding) and hands back
 * model/service accessors.
 *
 *   const auth = require('@xeplr/auth').attach();
 *   await auth.ready();
 *   await auth.model('User').query()...      // auth-package model bound to the auth DB
 *   auth.service.invite(...)                  // authService
 *
 * @returns {{ ready: () => Promise, conn: () => Knex, model: (name:string) => Model, service: object }}
 */
function attach() {
  var _conn = null;
  var _ready = (async function () {
    _conn = await getConnection(
      process.env.AUTH_DB_NAME || 'auth',
      authConnection(),
      { bind: false, connectionName: 'auth' }
    );
    authService.configureActivation({
    // Fully qualified, one per link — the token is the only thing appended.
    // AUTH_ACTIVATION_BASE_URL still works as an origin; see configureActivation.
    activationUrl: process.env.AUTH_ACTIVATION_URL || null,
    inviteUrl: process.env.AUTH_INVITE_URL || null,
    baseUrl: process.env.AUTH_ACTIVATION_BASE_URL || null
  });
    return _conn;
  })();

  function conn() {
    if (!_conn) throw new Error('auth.attach(): connection not ready — await ready() first');
    return _conn;
  }
  function model(name) {
    var M = models[name];
    if (!M) throw new Error('auth.attach(): unknown auth model "' + name + '"');
    return M.bindKnex(conn());
  }
  return { ready: function () { return _ready; }, conn: conn, model: model, service: authService };
}

// Env vars this library needs — apps spread this into their env.required.js so
// the names live here (change once, every app picks it up), not re-listed per app.
var requiredEnv = [
  'ENCRYPTION_KEY',
  'AUTH_JWT_SECRET',
  // NOT listed literally: the activation link can be given either as
  // AUTH_ACTIVATION_URL (fully qualified, preferred) or as the older
  // AUTH_ACTIVATION_BASE_URL (an origin). checkEnv takes a list of names and
  // demands every one, which would refuse to boot an install that configured
  // the new form. The getter below asks for whichever is actually in use.
  'AUTH_PORT',
  'AUTH_DB_NAME',                        // auth db (api reaches it via attach())
  'XEPLR_AUTH_MIGRATIONS',             // migrations run via migrate:up

  // THE FIRST ACCOUNT — consumed by migrations/0008_super_admin.sql, which
  // this package now ships so that every app does not hand-write the same
  // insert against columns this package owns.
  //
  // Required, not optional: an install that migrates cleanly and has nobody
  // who can sign in is not a working install, and the failure shows up much
  // later than the cause. The migrator refuses by name if either is unset,
  // so this listing only moves the same complaint to `check-env`, before
  // anything starts.
  'AUTH_SUPER_ADMIN_EMAIL',
  'AUTH_SUPER_ADMIN_PASSWORD',
];

// Read at ACCESS time so it reflects the .env the app has already loaded — the
// same reason @xeplr/email's requiredEnv is a getter. Names the form the
// install is actually using, and asks for the new one when neither is set.
Object.defineProperty(requiredEnv, 'activationLinkVar', {
  enumerable: false,
  get: function () {
    return process.env.AUTH_ACTIVATION_BASE_URL && !process.env.AUTH_ACTIVATION_URL
      ? 'AUTH_ACTIVATION_BASE_URL'
      : 'AUTH_ACTIVATION_URL';
  }
});

// NOT in requiredEnv, deliberately: AUTH_DB_CONNECTION_INFO_ENCRYPTED is now an
// OVERRIDE. The connection normally comes from the shared XEPLR_DB_CONNECTION,
// so demanding the auth-specific name would fail a correctly configured
// install. Missing-ness is caught at the point of use by resolveDbConnection,
// which names both variables.
//
// AUTH_DB_NAME stays required and stays auth's own — the DATABASE is a
// different question from the SERVER, and services do not share one.

module.exports = {
  // Hand in @xeplr-workflow/api's resumeByKey to release a step that is
  // waiting for someone to activate. Omitted, activation just activates.
  configureWorkflowResume: authService.configureWorkflowResume,
  requiredEnv,
  init,
  attach,
  router,
  adminRouter,
  start,
  boot,
  authMiddleware,
  accessMiddleware,
  requireRole,
  mtMembershipMiddleware,
  authHelper,
  seedSuperAdmin,
  authService,
  accessService,
  sessionService,
  ticketService,
  hooks,
  models
};

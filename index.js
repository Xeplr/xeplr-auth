const path = require('path');
const { getConnection, bindModels, resolveConfig, sqlMigrator } = require('@xeplr/db');
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
//   AUTH_EXT_MIGRATIONS_DIR · email vars · REDIS_*
async function boot() {
  var connName = 'auth';
  var database = process.env.AUTH_DB_NAME || 'auth';

  await resolveConfig(connName, process.env.AUTH_DB_CONNECTION_INFO_ENCRYPTED);

  // Self-migrate: auth's own .sql migrations (schema + base data), then the
  // app's extension dir. Idempotent — same as `xeplr-auth-migrate up`.
  var migrationResult = await sqlMigrator.up({
    db: database,
    dir: path.join(__dirname, 'migrations'),
    extDir: process.env.AUTH_EXT_MIGRATIONS_DIR || null,
    type: 'precede',
    connectionName: connName
  });
  console.log(migrationResult.migrations.length
    ? '[xeplr-auth] ran ' + migrationResult.migrations.length + ' migrations'
    : '[xeplr-auth] migrations up to date');

  // Configure email (via @xeplr/utils, the engine auth uses) + activation links.
  require('@xeplr/utils').configureFromEnv();
  if (process.env.AUTH_ACTIVATION_BASE_URL) authService.configureActivation(process.env.AUTH_ACTIVATION_BASE_URL);

  var server = await start({
    database: database,
    connectionName: connName,
    connection: process.env.AUTH_DB_CONNECTION_INFO_ENCRYPTED,
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
    ['ext migrations',     process.env.AUTH_EXT_MIGRATIONS_DIR || '(none)'],
    ['activation url',     process.env.AUTH_ACTIVATION_BASE_URL || '(none)'],
    ['access token ttl',   (process.env.AUTH_ACCESS_TOKEN_TTL_MINUTES || '15') + 'm'],
    ['refresh token ttl',  (process.env.AUTH_REFRESH_TOKEN_TTL_DAYS || '7') + 'd'],
    ['slide tolerance',    (process.env.AUTH_ACCESS_TOKEN_TOLERANCE_SECONDS || '0') + 's'],
    ['max sessions/user',  process.env.AUTH_MAX_SESSIONS_PER_USER || '5'],
    ['redis',              (process.env.REDIS_HOST || 'localhost') + ':' + (process.env.REDIS_PORT || '6379')],
    ['email',              process.env.EMAIL_PROVIDER || '(not configured)'],
    ['connection',         set(process.env.AUTH_DB_CONNECTION_INFO_ENCRYPTED)],
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
      process.env.AUTH_DB_CONNECTION_INFO_ENCRYPTED,
      { bind: false, connectionName: 'auth' }
    );
    if (process.env.AUTH_ACTIVATION_BASE_URL) authService.configureActivation(process.env.AUTH_ACTIVATION_BASE_URL);
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
  'AUTH_ACTIVATION_BASE_URL',
  'AUTH_PORT',
  'AUTH_DB_NAME',                        // auth db (api reaches it via attach())
  'AUTH_DB_CONNECTION_INFO_ENCRYPTED',   // auth DB login (for attach())
  'AUTH_EXT_MIGRATIONS_DIR',             // migrations run via migrate:up
];

module.exports = {
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

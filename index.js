const path = require('path');
const { getConnection, bindModels, resolveConfig, migrator } = require('@xeplr/db');
const { createApp } = require('@xeplr/base-apis');
const authHelper = require('./lib/authHelper');
const authMiddleware = require('./lib/authMiddleware');
const authService = require('./lib/authService');
const accessService = require('./lib/accessService');
const { accessMiddleware, requireRole } = require('./lib/accessMiddleware');
const sessionService = require('./lib/sessionService');
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
function init(config = {}) {
  // Setup database connection
  const dbName = config.database || process.env.DB_AUTH || 'auth';
  const dbOptions = Object.assign({ connectionName: config.connectionName || 'auth' }, config.db || {});
  const connection = getConnection(dbName, dbOptions);
  bindModels(connection);

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
function start(config = {}) {
  init(config);

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
 * Boot xeplr-auth as a fully independent service.
 * Resolves DB config, runs migrations/seeds, and starts the server.
 *
 * @param {object} config
 * @param {number|string} config.port - Port to listen on (default: AUTH_PORT env or 19001)
 * @param {string} config.database - Database name for auth tables
 * @param {string} [config.connectionName] - Named connection identifier (default: 'auth')
 * @param {object} [config.db] - DB connection options { host, user, password, port }
 * @param {object} [config.jwt] - JWT options { secret, accessTokenExpiresIn }
 * @param {object} [config.email] - Email config { provider, smtp, aws, azure, brevo }
 * @param {string} [config.resetBaseUrl] - Base URL for reset links
 * @param {string} [config.migrationsDir] - Additional project-specific migrations directory
 * @param {string} [config.seedsDir] - Additional project-specific seeds directory
 * @param {object} [config.corsOptions] - CORS options
 * @param {Function[]} [config.middleware] - Additional middleware
 * @returns {Promise<http.Server>}
 */
async function boot(config = {}) {
  var connName = config.connectionName || 'auth';
  var database = config.database || process.env.DB_AUTH || 'auth';
  var authPkgDir = path.join(__dirname);

  await resolveConfig(connName);

  // Run migrations
  var migrationResult = await migrator.up({
    db: database,
    dir: path.join(authPkgDir, 'migrations'),
    extDir: config.migrationsDir || null,
    type: 'precede',
    connectionName: connName
  });

  if (migrationResult.migrations.length > 0) {
    console.log('[xeplr-auth] ran ' + migrationResult.migrations.length + ' migrations');
  } else {
    console.log('[xeplr-auth] migrations up to date');
  }

  // Run seeds (auth's own seeds always run, project seeds if provided)
  var seedResult = await migrator.seed({
    db: database,
    seedsDir: path.join(authPkgDir, 'seeds'),
    extSeedsDir: config.seedsDir || null,
    type: 'precede',
    connectionName: connName
  });

  if (seedResult.length > 0) {
    console.log('[xeplr-auth] ran ' + seedResult.length + ' seeds');
  }

  return start(Object.assign({ database, connectionName: connName }, config));
}

module.exports = {
  init,
  router,
  adminRouter,
  start,
  boot,
  authMiddleware,
  accessMiddleware,
  requireRole,
  authHelper,
  authService,
  accessService,
  sessionService,
  models
};

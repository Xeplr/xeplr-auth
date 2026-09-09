#!/usr/bin/env node

/**
 * Standalone auth service. Reads AUTH_* env — the LAUNCHER provides it; this bin
 * reads process.env only and loads no .env of its own. The consuming app does:
 *   "start-auth": "dotenv -e development.env -- xeplr-auth-server"
 *
 * env: ENCRYPTION_KEY · AUTH_DB_CONNECTION_INFO_ENCRYPTED · AUTH_DB_NAME ·
 *      AUTH_JWT_SECRET · AUTH_PORT · AUTH_ACTIVATION_BASE_URL ·
 *      AUTH_ACCESS_TOKEN_TTL_MINUTES · XEPLR_AUTH_MIGRATIONS · email vars · REDIS_*
 */
require('../index').boot().then(function () {
  if (process.send) process.send({ status: 'ready' });
}).catch(function (err) {
  console.error('[auth] startup failed:', err.stack || err.message);
  process.exit(1);
});

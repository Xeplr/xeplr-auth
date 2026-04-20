#!/usr/bin/env node

/**
 * Standalone auth server entry point.
 * Designed to be forked as a child process or run directly.
 *
 * Reads config from AUTH_CONFIG env var (JSON) or individual env vars.
 */
var auth = require('../index');

var config = {};

if (process.env.AUTH_CONFIG) {
  try {
    config = JSON.parse(process.env.AUTH_CONFIG);
  } catch (e) {
    console.error('Failed to parse AUTH_CONFIG:', e.message);
    process.exit(1);
  }
}

config.port = config.port || process.env.AUTH_PORT || 19001;
config.database = config.database || process.env.DB_AUTH || 'architects_auth';

if (process.env.JWT_SECRET) {
  config.jwt = config.jwt || {};
  config.jwt.secret = config.jwt.secret || process.env.JWT_SECRET;
}

auth.start(config);

// Notify parent process (if forked) that auth is ready
if (process.send) {
  process.send({ status: 'ready', port: config.port });
}

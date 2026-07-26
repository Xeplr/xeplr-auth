#!/usr/bin/env node

// Reads process.env ONLY. The consuming app loads its .env (e.g. via dotenv-cli
// in the npm script) — @xeplr/* packages never read .env files.

const path = require('path');
const { up, status } = require('@xeplr/db').sqlMigrator;
const { resolveConfig } = require('@xeplr/db');

/**
 * xeplr-auth-migrate
 *
 * Runs auth's bundled .sql migrations, followed by the consumer app's
 * EXTENSION migrations dir (schema + data — auth has no separate seed step;
 * base data lives in migrations so it runs exactly once). Reuses xeplr-db's
 * sqlMigrator — hand-written .sql files, no down(), ledger-tracked.
 *
 * The app points at its extension dir ONCE via env: AUTH_EXT_MIGRATIONS_DIR
 * (or --extDir). Base migrations run first, then the app's — one ledger.
 *
 * Usage:
 *   xeplr-auth-migrate up [--extDir <dir>] [--db <database>]
 *   xeplr-auth-migrate status [--extDir <dir>] [--db <database>]
 */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] || true;
      i++;
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  // Bundled auth migrations (base) + the app's extension migrations dir, which
  // the app configures ONCE via AUTH_EXT_MIGRATIONS_DIR (or --extDir). Base runs
  // first, then the extension — one shared ledger.
  const options = {
    ...args,
    db: args.db || process.env.AUTH_DB_NAME,
    dir: path.join(__dirname, '..', 'migrations'),
    extDir: args.extDir || args['ext-dir'] || process.env.AUTH_EXT_MIGRATIONS_DIR,
    connectionName: args['connection-name'] || args.connectionName || 'auth'
  };

  if (['up', 'status'].indexOf(command) !== -1) {
    // App tells us which secret to use (decoupled from the connection name):
    //   --connection <encrypted> | --connection-env <ENV_NAME>. Omit → legacy
    //   <connectionName>_CONNECTION fallback inside resolveConfig.
    var connSource = args.connection ||
      (args['connection-env'] && process.env[args['connection-env']]) || undefined;
    await resolveConfig(options.connectionName, connSource);
  }

  switch (command) {
    case 'up': {
      const result = await up(options);
      if (result.migrations.length === 0) {
        console.log('Already up to date');
      } else {
        console.log(`Ran ${result.migrations.length} migrations:`);
        result.migrations.forEach(m => console.log(`  - ${m}`));
      }
      break;
    }
    case 'status': {
      const result = await status(options);
      console.log('Completed migrations:');
      result.completed.forEach(m => console.log(`  ✓ ${m}`));
      if (result.pending.length) {
        console.log('Pending migrations:');
        result.pending.forEach(m => console.log(`  ○ ${m}`));
      } else {
        console.log('No pending migrations');
      }
      if (result.drift.length) {
        console.log('WARNING - applied migrations edited after the fact (checksum mismatch):');
        result.drift.forEach(m => console.log(`  ! ${m}`));
      }
      break;
    }
    default:
      console.log('xeplr-auth-migrate - Auth database migrations');
      console.log('');
      console.log('Commands:');
      console.log('  up [--extDir <dir>]     Run base + app extension migrations');
      console.log('  status [--extDir <dir>] Show migration status');
      console.log('');
      console.log('  App extension dir: --extDir or AUTH_EXT_MIGRATIONS_DIR env');
      console.log('');
      console.log('Options:');
      console.log('  --db        Database name (or AUTH_DB_NAME env)');
      console.log('  --host      DB host (default: DB_HOST env or localhost)');
      console.log('  --user      DB user (default: DB_USER env or root)');
      console.log('  --password  DB password (default: DB_PASSWORD env)');
      console.log('');
      console.log('Migrations are hand-written .sql files (see migrations/), applied once,');
      console.log('no down(). 0007_seed_super_admin.sql requires SUPER_ADMIN_PASSWORD in env.');
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});

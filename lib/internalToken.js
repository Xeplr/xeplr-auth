/**
 * internalToken — a token the SERVER makes for itself, to call its own API
 * (or another xeplr service) as a user: a scheduled export, a print, a job
 * step. A library function, never a route — nothing outside the server can
 * make one.
 *
 *   const token = await createInternalToken({ id, email, name, roles })
 *   fetch(api + '/reports/r1/export', { headers: { authorization: 'Bearer ' + token, … } })
 *
 * A random string (`xit_` + 32 random bytes) kept in Redis with the user it
 * acts as, for 30 seconds unless asked otherwise. authMiddleware knows it by
 * its prefix and serves the request as that user — so /verify, every app's
 * gate, the company membership and the API access rules apply to it exactly
 * as to a sign-in token: it opens nothing that user could not open.
 *
 * Long and random, not a short code: it works on the API, so it must not be
 * guessable within its life. Not single-use: an export is started, waited on
 * and fetched with one token, within its 30 seconds.
 *
 * Keys go through @xeplr/utils' cache, under REDIS_PREFIX — the same Redis
 * and prefix the auth service reads, as for sessions.
 */
const crypto = require('crypto');
const { cache } = require('@xeplr/utils');

const KEY = 'token:internal:';
const PREFIX = 'xit_';
const DEFAULT_TTL = 30;      // seconds
const MAX_TTL = 300;

/** Whether a bearer token is an internal one (by its prefix). */
function isInternalToken(token) {
  return typeof token === 'string' && token.startsWith(PREFIX);
}

/**
 * Make a token acting as `user` ({ id, email, name, roles: [names] } — the
 * claims a sign-in carries). Throws if Redis is unreachable: an auth surface
 * fails loud.
 *
 * @param {object} user
 * @param {object} [opts]  { ttl } seconds, 1–300 (default 30)
 * @returns {Promise<string>}
 */
async function createInternalToken(user, opts) {
  if (!user || !user.id) throw new Error('createInternalToken: user.id is required');
  const ttl = Math.min(MAX_TTL, Math.max(1, Math.floor(Number((opts && opts.ttl) || DEFAULT_TTL))));
  const token = PREFIX + crypto.randomBytes(32).toString('base64url');
  const claims = {
    id: user.id, email: user.email || null, name: user.name || null,
    roles: Array.isArray(user.roles) ? user.roles.map(function(r) { return typeof r === 'string' ? r : r && r.name; }).filter(Boolean) : [],
    internal: true
  };
  await cache.getClient().set(KEY + token, JSON.stringify(claims), 'EX', ttl);
  return token;
}

/** The user an internal token acts as, or null (unknown, or its time is up). */
async function readInternalToken(token) {
  if (!isInternalToken(token)) return null;
  const raw = await cache.getClient().get(KEY + token);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

module.exports = { createInternalToken, readInternalToken, isInternalToken, DEFAULT_TTL };

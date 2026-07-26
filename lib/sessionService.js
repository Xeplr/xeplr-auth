/**
 * Session service — manages access + refresh token pairs in Redis.
 *
 * A "session" = one device/browser login, containing:
 *   - An access token (short-lived, 15m)
 *   - A refresh token (long-lived, 7d)
 *
 * Redis keys:
 *   session:{refreshToken}     → { userId, accessToken, createdAt }
 *   access:{accessToken}       → { userId, refreshToken }   (for whitelist check)
 *   sessions:user:{userId}     → Sorted Set of refreshTokens (score = createdAt)
 *
 * Env vars:
 *   REFRESH_TOKEN_TTL_DAYS     — refresh token lifetime (default: 7)
 *   ACCESS_TOKEN_TTL_MINUTES   — access token lifetime (default: 15)
 *   MAX_SESSIONS_PER_USER      — max concurrent sessions (default: 5)
 */

const { cache } = require('@xeplr/utils');
const { generateRefreshToken, generateAccessToken, getToleranceSeconds } = require('./authHelper');

const SESSION_PREFIX = 'session:';
const ACCESS_PREFIX = 'access:';
const USER_PREFIX = 'sessions:user:';

function getRefreshTTL() {
  const days = parseInt(process.env.AUTH_REFRESH_TOKEN_TTL_DAYS || '7');
  return days * 24 * 60 * 60;
}

function getAccessTTL() {
  const minutes = parseInt(process.env.AUTH_ACCESS_TOKEN_TTL_MINUTES || '15');
  return minutes * 60;
}

function getMaxSessions() {
  return parseInt(process.env.AUTH_MAX_SESSIONS_PER_USER || '5');
}

/**
 * Create a new session (access + refresh token pair).
 * Evicts oldest session(s) if max sessions exceeded.
 *
 * @param {object} user - User object (id, email, name)
 * @returns {{ accessToken, refreshToken }}
 */
async function createSession(user) {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();
  const now = Date.now();
  const refreshTTL = getRefreshTTL();
  const accessTTL = getAccessTTL();

  // Store session keyed by refresh token
  await cache.set(SESSION_PREFIX + refreshToken, {
    userId: user.id,
    accessToken,
    createdAt: now
  }, refreshTTL);

  // Store access token whitelist entry (for middleware check). The entry lives
  // accessTTL + tolerance so it's still present during the grace window — that's
  // what lets an expired-but-tolerated token find its live session and slide.
  await cache.set(ACCESS_PREFIX + accessToken, {
    userId: user.id,
    refreshToken
  }, accessTTL + getToleranceSeconds());

  // Track session in user's sorted set
  const client = cache.getClient();
  try {
    await client.zadd(USER_PREFIX + user.id, now, refreshToken);
    await client.expire(USER_PREFIX + user.id, refreshTTL);

    // Enforce session limit
    await evictExcessSessions(user.id);
  } catch (e) {
    // Silently fail
  }

  return { accessToken, refreshToken };
}

/**
 * Evict oldest sessions if user exceeds MAX_SESSIONS_PER_USER.
 */
async function evictExcessSessions(userId) {
  const client = cache.getClient();
  const maxSessions = getMaxSessions();
  const count = await client.zcard(USER_PREFIX + userId);

  if (count <= maxSessions) return;

  const excess = count - maxSessions;
  const oldRefreshTokens = await client.zrange(USER_PREFIX + userId, 0, excess - 1);

  if (oldRefreshTokens && oldRefreshTokens.length > 0) {
    const pipeline = client.pipeline();

    for (const rt of oldRefreshTokens) {
      // Look up the session to find the paired access token
      const sessionData = await cache.get(SESSION_PREFIX + rt);
      if (sessionData && sessionData.accessToken) {
        pipeline.del(ACCESS_PREFIX + sessionData.accessToken);
      }
      pipeline.del(SESSION_PREFIX + rt);
    }

    // Remove from sorted set
    pipeline.zremrangebyrank(USER_PREFIX + userId, 0, excess - 1);
    await pipeline.exec();
  }
}

/**
 * Get session data by refresh token.
 * Returns { userId, accessToken, createdAt } or null.
 */
async function getSession(refreshToken) {
  return await cache.get(SESSION_PREFIX + refreshToken);
}

/**
 * Validate an access token against the Redis whitelist.
 * Returns { userId, refreshToken } if valid, null if revoked/expired.
 */
async function validateAccessToken(accessToken) {
  return await cache.get(ACCESS_PREFIX + accessToken);
}

/**
 * Slide an access token — the sliding refresh. Given an expired-but-tolerated
 * access token (already signature-verified + session confirmed live by the
 * middleware), mint a fresh access token for the SAME session and return it,
 * so the middleware can hand it back on the response.
 *
 * Session-scoped IDEMPOTENT: if the session already slid to a newer token
 * (a concurrent request beat us to it), hand that SAME token back instead of
 * minting another — so 100 parallel requests yield ONE new token, not 100.
 *
 * The OLD token is deliberately left whitelisted (it expires on its own TTL),
 * so other in-flight requests still carrying it keep passing during the window.
 *
 * NOTE: on a single node the check-then-set is race-free. Under HA/cluster,
 * wrap the mint in a short Redis lock (or a Lua script) for atomicity.
 *
 * @param {string} oldToken   the expired-but-tolerated access token
 * @param {object} claims     its verified JWT claims { id, email, name, roles }
 * @returns {Promise<string|null>} the fresh access token, or null if no session
 */
async function slideAccessToken(oldToken, claims) {
  const wl = await cache.get(ACCESS_PREFIX + oldToken);
  if (!wl || !wl.refreshToken) return null;

  const session = await cache.get(SESSION_PREFIX + wl.refreshToken);
  if (!session) return null;

  // Already slid by a concurrent request → return the current token (idempotent).
  if (session.accessToken && session.accessToken !== oldToken) {
    return session.accessToken;
  }

  // Mint from the token's own claims — no DB hit. (Roles refresh fully on the
  // next /refresh or re-login; sliding just extends the active session.)
  const newToken = generateAccessToken({
    id: claims.id, email: claims.email, name: claims.name, roles: claims.roles || []
  });
  const whitelistTTL = getAccessTTL() + getToleranceSeconds();

  await cache.set(ACCESS_PREFIX + newToken, { userId: wl.userId, refreshToken: wl.refreshToken }, whitelistTTL);
  await cache.set(SESSION_PREFIX + wl.refreshToken, Object.assign({}, session, { accessToken: newToken }), getRefreshTTL());

  return newToken;
}

/**
 * Rotate a session — validate old refresh token, create new pair.
 * Returns { accessToken, refreshToken, userId } or null.
 */
async function rotateSession(oldRefreshToken, user) {
  const session = await cache.get(SESSION_PREFIX + oldRefreshToken);
  if (!session || !session.userId) return null;

  // Delete old session
  await destroySession(oldRefreshToken);

  // Create new session (limit check happens inside)
  const tokens = await createSession(user);
  return { ...tokens, userId: session.userId };
}

/**
 * Destroy a specific session (logout from one device).
 */
async function destroySession(refreshToken) {
  const session = await cache.get(SESSION_PREFIX + refreshToken);

  if (session) {
    // Delete the access token whitelist entry
    if (session.accessToken) {
      await cache.del(ACCESS_PREFIX + session.accessToken);
    }

    // Remove from user's sorted set
    if (session.userId) {
      const client = cache.getClient();
      try {
        await client.zrem(USER_PREFIX + session.userId, refreshToken);
      } catch (e) {
        // Silently fail
      }
    }
  }

  // Delete the session itself
  await cache.del(SESSION_PREFIX + refreshToken);
}

/**
 * Destroy ALL sessions for a user (password change, force logout all devices).
 */
async function destroyAllUserSessions(userId) {
  const client = cache.getClient();
  try {
    const refreshTokens = await client.zrange(USER_PREFIX + userId, 0, -1);

    if (refreshTokens && refreshTokens.length > 0) {
      const pipeline = client.pipeline();

      for (const rt of refreshTokens) {
        const session = await cache.get(SESSION_PREFIX + rt);
        if (session && session.accessToken) {
          pipeline.del(ACCESS_PREFIX + session.accessToken);
        }
        pipeline.del(SESSION_PREFIX + rt);
      }

      pipeline.del(USER_PREFIX + userId);
      await pipeline.exec();
    } else {
      await client.del(USER_PREFIX + userId);
    }
  } catch (e) {
    // Fallback
    await cache.delPattern('session:*');
    await cache.delPattern('access:*');
  }
}

module.exports = {
  createSession,
  getSession,
  validateAccessToken,
  slideAccessToken,
  rotateSession,
  destroySession,
  destroyAllUserSessions
};

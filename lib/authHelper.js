const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

let _config = {};

/**
 * Configure auth helper.
 * @param {object} config
 * @param {string} config.jwtSecret
 * @param {string} [config.jwtExpiresIn='24h']
 * @param {number} [config.saltRounds=10]
 */
function configure(config) {
  _config = { ..._config, ...config };
}

function getSecret() {
  return _config.jwtSecret || process.env.AUTH_JWT_SECRET || 'change_me_in_production';
}

function generateId() {
  return crypto.randomBytes(12).toString('hex').substring(0, 25);
}

async function hashPassword(password) {
  const rounds = _config.saltRounds || 10;
  const salt = await bcrypt.genSalt(rounds);
  const hash = await bcrypt.hash(password, salt);
  return { hash, salt };
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateAccessToken(user) {
  // Caller is responsible for providing `roles` as an array of role names
  // (see authService.login → withGraphFetched('roles'))
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: Array.isArray(user.roles) ? user.roles : []
  };
  const expiresIn = _config.accessTokenExpiresIn || '15m';
  return jwt.sign(payload, getSecret(), { expiresIn });
}

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

// Verify the SIGNATURE but ignore expiry — the middleware decides on expiry
// itself (so it can apply the tolerance window). Returns { decoded, signatureValid }.
function decodeVerified(token) {
  try {
    return { decoded: jwt.verify(token, getSecret(), { ignoreExpiration: true }), signatureValid: true };
  } catch (err) {
    return { decoded: null, signatureValid: false };
  }
}

// Grace window (seconds) during which an expired access token is still honored
// and slid to a fresh one. 0 = strict (reject on expiry) = default / back-compat.
function getToleranceSeconds() {
  var t = _config.accessTokenToleranceSeconds;
  if (t === undefined || t === null) t = parseInt(process.env.AUTH_ACCESS_TOKEN_TOLERANCE_SECONDS || '0', 10);
  return (Number.isFinite(t) && t > 0) ? t : 0;
}

module.exports = {
  configure,
  generateId,
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  decodeVerified,
  getToleranceSeconds
};

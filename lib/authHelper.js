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
  return _config.jwtSecret || process.env.JWT_SECRET || 'change_me_in_production';
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
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name
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

module.exports = {
  configure,
  generateId,
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyToken
};

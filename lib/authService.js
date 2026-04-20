const crypto = require('crypto');
const { sendEmail, configureEmail, formatDbDateTime } = require('@xeplr/utils');
const { normalizeEmail } = require('@xeplr/utils/isomorphic');
const { generateId, hashPassword, comparePassword } = require('./authHelper');
const User = require('../models/User');
const { getUserAccess, clearUserAccess } = require('./accessService');
const { createSession, destroyAllUserSessions } = require('./sessionService');

let _activationBaseUrl = null;

function configureActivation(baseUrl) {
  _activationBaseUrl = baseUrl;
}

async function register({ email, phoneNumber, name, password }) {
  const normalized = normalizeEmail(email);

  const existing = await User.query().findOne({ normalizedEmail: normalized });
  if (existing) {
    throw new Error('Email already registered');
  }

  const id = generateId();
  const { hash, salt } = await hashPassword(password);
  const now = formatDbDateTime();
  const activationToken = crypto.randomBytes(32).toString('hex');

  const user = await User.query().insert({
    id,
    email: email.trim().toLowerCase(),
    normalizedEmail: normalized,
    phoneNumber: phoneNumber || null,
    name: name || null,
    pwd: hash,
    pwdSalt: salt,
    isActive: true,
    isActivated: false,
    activationToken,
    activatedOn: null,
    activatedBy: null,
    recordCreatedDate: now,
    recordModifiedDate: now,
    recordCreatedBy: id,
    recordModifiedBy: id
  });

  // Send activation email
  const baseUrl = _activationBaseUrl || process.env.ACTIVATION_BASE_URL;
  if (!baseUrl) {
    throw new Error('ACTIVATION_BASE_URL is required. Cannot register without email activation.');
  }

  const activationLink = baseUrl + '/auth/activate?token=' + activationToken;
  const html = '<h2>Activate your account</h2>'
    + '<p>Hi ' + (name || 'there') + ',</p>'
    + '<p>Click below to activate your account:</p>'
    + '<p><a href="' + activationLink + '">' + activationLink + '</a></p>';

  await sendEmail(email, 'Activate your account', html);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phoneNumber: user.phoneNumber,
    isActive: user.isActive,
    isActivated: user.isActivated
  };
}

async function activate(token) {
  const user = await User.query().findOne({ activationToken: token });
  if (!user) {
    throw new Error('Invalid activation token');
  }

  if (user.isActivated) {
    throw new Error('Account already activated');
  }

  const now = formatDbDateTime();
  await User.query().findById(user.id).patch({
    isActivated: true,
    activatedOn: now,
    activationToken: null,
    recordModifiedDate: now
  });

  return { id: user.id, email: user.email, name: user.name };
}

async function login({ email, password }) {
  const normalized = normalizeEmail(email);
  const user = await User.query().findOne({ normalizedEmail: normalized });
  if (!user) {
    throw new Error('Invalid email or password');
  }

  if (!user.isActive) {
    throw new Error('Account is deactivated');
  }

  const isMatch = await comparePassword(password, user.pwd);
  if (!isMatch) {
    throw new Error('Invalid email or password');
  }

  if (!user.isActivated) {
    throw new Error('NOT_ACTIVATED');
  }

  const { accessToken, refreshToken } = await createSession(user);

  await clearUserAccess(user.id);
  const access = await getUserAccess(user.id);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isActivated: user.isActivated
    },
    access
  };
}

async function forgotPassword({ email }, resetBaseUrl) {
  const normalized = normalizeEmail(email);
  const user = await User.query().findOne({ normalizedEmail: normalized });
  if (!user) {
    return;
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiryMinutes = parseInt(process.env.RESET_TOKEN_EXPIRY_MINUTES) || 30;
  const resetTokenExpiry = formatDbDateTime(new Date(Date.now() + expiryMinutes * 60 * 1000));

  await User.query().findById(user.id).patch({
    resetToken,
    resetTokenExpiry,
    recordModifiedDate: formatDbDateTime()
  });

  const resetLink = `${resetBaseUrl}/auth/reset-password?token=${resetToken}`;

  const html = `
    <h2>Password Reset</h2>
    <p>Hi ${user.name || 'there'},</p>
    <p>You requested a password reset. Click the link below to reset your password:</p>
    <p><a href="${resetLink}">${resetLink}</a></p>
    <p>This link expires in ${expiryMinutes} minutes.</p>
    <p>If you didn't request this, ignore this email.</p>
  `;

  await sendEmail(user.email, 'Password Reset', html);
}

async function resetPassword({ token, newPassword }) {
  const user = await User.query().findOne({ resetToken: token });

  if (!user) {
    throw new Error('Invalid or expired reset token');
  }

  if (user.resetTokenExpiry < formatDbDateTime()) {
    throw new Error('Invalid or expired reset token');
  }

  const { hash, salt } = await hashPassword(newPassword);

  await User.query().findById(user.id).patch({
    pwd: hash,
    pwdSalt: salt,
    resetToken: null,
    resetTokenExpiry: null,
    recordModifiedDate: formatDbDateTime()
  });

  await destroyAllUserSessions(user.id);
  await clearUserAccess(user.id);
}

module.exports = {
  configureActivation,
  configureEmail,
  register,
  activate,
  login,
  forgotPassword,
  resetPassword
};

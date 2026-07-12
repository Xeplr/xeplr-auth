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

async function register({ email, phoneNumber, name, password, knex }) {
  const UserM = knex ? User.bindKnex(knex) : User;
  const normalized = normalizeEmail(email);

  const existing = await UserM.query().findOne({ normalizedEmail: normalized });
  if (existing) {
    throw new Error('Email already registered');
  }

  const id = generateId();
  const { hash, salt } = await hashPassword(password);
  const now = formatDbDateTime();
  const activationToken = crypto.randomBytes(32).toString('hex');

  const user = await UserM.query().insert({
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
  const user = await User.query()
    .findOne({ normalizedEmail: normalized })
    .withGraphFetched('roles');
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

  // Pack role names into the JWT so middleware (e.g. requireSuperAdmin)
  // can gate without a per-request DB lookup.
  const tokenUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: (user.roles || []).map(function(r) { return r.name; })
  };

  const { accessToken, refreshToken } = await createSession(tokenUser);

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

/**
 * Invite a user. Creates a User row with no password, isActivated=false, and an
 * activation token. Sends an "accept invite" email pointing the user to a page
 * where they set their own password and activate.
 *
 * Idempotent on email: if the user already exists, returns the existing user
 * (no email sent, no password reset). The caller can then layer additional
 * roles/mappings on top.
 */
async function invite({ email, name, phoneNumber, invitedBy, inviterName, appName, knex }) {
  const UserM = knex ? User.bindKnex(knex) : User;
  const normalized = normalizeEmail(email);

  const existing = await UserM.query().findOne({ normalizedEmail: normalized });
  if (existing) {
    return {
      id: existing.id,
      email: existing.email,
      name: existing.name,
      isNew: false,
      isActivated: existing.isActivated
    };
  }

  const id = generateId();
  const now = formatDbDateTime();
  const activationToken = crypto.randomBytes(32).toString('hex');
  const inviter = invitedBy || id;

  const user = await UserM.query().insert({
    id,
    email: email.trim().toLowerCase(),
    normalizedEmail: normalized,
    phoneNumber: phoneNumber || null,
    name: name || null,
    pwd: null,
    pwdSalt: null,
    isActive: true,
    isActivated: false,
    activationToken,
    activatedOn: null,
    activatedBy: null,
    recordCreatedDate: now,
    recordModifiedDate: now,
    recordCreatedBy: inviter,
    recordModifiedBy: inviter
  });

  const baseUrl = _activationBaseUrl || process.env.ACTIVATION_BASE_URL;
  if (!baseUrl) {
    throw new Error('ACTIVATION_BASE_URL is required to send invite emails.');
  }

  const acceptLink = baseUrl + '/auth/accept-invite?token=' + activationToken;
  const app = appName || 'the app';
  const subject = 'You have been invited to ' + app;
  const html = '<h2>You have been invited</h2>'
    + '<p>Hi ' + (name || 'there') + ',</p>'
    + (inviterName ? '<p>' + inviterName + ' has invited you to join ' + app + '.</p>' : '<p>You have been invited to join ' + app + '.</p>')
    + '<p>Click below to set your password and accept the invite:</p>'
    + '<p><a href="' + acceptLink + '">' + acceptLink + '</a></p>';

  await sendEmail(email, subject, html);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isNew: true,
    isActivated: false
  };
}

/**
 * Preview an invite — returns invitee info if the token matches a pending
 * invite (user exists, is not activated, and has no password set yet).
 */
async function previewInvite(token, options = {}) {
  const UserM = options.knex ? User.bindKnex(options.knex) : User;
  const user = await UserM.query().findOne({ activationToken: token });
  if (!user) throw new Error('Invalid or expired invite');
  if (user.isActivated) throw new Error('Invite already accepted');
  if (user.pwd) throw new Error('This account already has a password — use the activation link instead');

  return { email: user.email, name: user.name };
}

/**
 * Accept an invite — sets the user's password and name, then activates.
 */
async function acceptInvite({ token, name, password, knex }) {
  if (!password) throw new Error('Password is required');

  const UserM = knex ? User.bindKnex(knex) : User;
  const user = await UserM.query().findOne({ activationToken: token });
  if (!user) throw new Error('Invalid or expired invite');
  if (user.isActivated) throw new Error('Invite already accepted');

  const { hash, salt } = await hashPassword(password);
  const now = formatDbDateTime();

  await UserM.query().findById(user.id).patch({
    name: name || user.name,
    pwd: hash,
    pwdSalt: salt,
    isActivated: true,
    activatedOn: now,
    activationToken: null,
    recordModifiedDate: now
  });

  return { id: user.id, email: user.email, name: name || user.name };
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
  invite,
  previewInvite,
  acceptInvite,
  login,
  forgotPassword,
  resetPassword
};

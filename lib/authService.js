const crypto = require('crypto');
const { sendEmail, configureEmail, formatDbDateTime, otp } = require('@xeplr/utils');
const { normalizeEmail } = require('@xeplr/utils/isomorphic');
const { generateId, hashPassword, comparePassword } = require('./authHelper');
const User = require('../models/User');
const { getUserAccess, clearUserAccess } = require('./accessService');
const { createSession, destroyAllUserSessions } = require('./sessionService');
const hooks = require('./hooks');

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
  const baseUrl = _activationBaseUrl || process.env.AUTH_ACTIVATION_BASE_URL;
  if (!baseUrl) {
    throw new Error('ACTIVATION_BASE_URL is required. Cannot register without email activation.');
  }

  const activationLink = baseUrl + '/auth/activate?token=' + activationToken;
  const html = '<h2>Activate your account</h2>'
    + '<p>Hi ' + (name || 'there') + ',</p>'
    + '<p>Click below to activate your account:</p>'
    + '<p><a href="' + activationLink + '">' + activationLink + '</a></p>';

  await sendEmail(email, 'Activate your account', html);

  await hooks.fire('user', 'create', user.id);

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

  await hooks.fire('user', 'update', user.id);

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

  await hooks.fire('user', 'login', user.id);

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

  const baseUrl = _activationBaseUrl || process.env.AUTH_ACTIVATION_BASE_URL;
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

  await hooks.fire('user', 'create', user.id);

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

  await hooks.fire('user', 'update', user.id);

  return { id: user.id, email: user.email, name: name || user.name };
}

async function forgotPassword({ email }, resetBaseUrl) {
  const normalized = normalizeEmail(email);
  const user = await User.query().findOne({ normalizedEmail: normalized });
  if (!user) {
    return;
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiryMinutes = parseInt(process.env.AUTH_RESET_TOKEN_EXPIRY_MINUTES) || 30;
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

  await hooks.fire('user', 'update', user.id);
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

  await hooks.fire('user', 'update', user.id);
}

/**
 * Send an OTP to verify a phone number on an already-authenticated user's
 * account (additive — like email activation, not a replacement for password
 * login). Delivery + code storage are @xeplr/utils's otp module — register an
 * sms provider (see @xeplr/utils sms.register()) from your own boot script
 * before calling boot(), otherwise this throws "provider not registered".
 *
 * @param {string} userId
 * @param {string} [phoneNumber] - set/replace the number on file; omit to
 *   re-send a code to the number already on the account.
 */
async function requestPhoneOtp(userId, phoneNumber) {
  const user = await User.query().findById(userId);
  if (!user) throw new Error('User not found');

  const targetPhone = phoneNumber || user.phoneNumber;
  if (!targetPhone) throw new Error('phoneNumber is required');

  if (phoneNumber && phoneNumber !== user.phoneNumber) {
    // Changing the number on file invalidates any prior verification.
    await User.query().findById(userId).patch({
      phoneNumber: targetPhone,
      phoneVerified: false,
      recordModifiedDate: formatDbDateTime()
    });
    await hooks.fire('user', 'update', userId);
  }

  await otp.requestOtp(targetPhone);
  return { sent: true };
}

/**
 * Verify a code against the phone number currently on file for this user.
 */
async function verifyPhoneOtp(userId, code) {
  const user = await User.query().findById(userId);
  if (!user) throw new Error('User not found');
  if (!user.phoneNumber) throw new Error('No phone number on file — request a code first');

  const result = await otp.verifyOtp(user.phoneNumber, code);
  if (!result.success) {
    const messages = {
      expired: 'Code expired — request a new one',
      too_many_attempts: 'Too many attempts — request a new code',
      invalid: 'Invalid code'
    };
    throw new Error(messages[result.reason] || 'Invalid code');
  }

  const now = formatDbDateTime();
  await User.query().findById(userId).patch({
    phoneVerified: true,
    phoneVerifiedOn: now,
    recordModifiedDate: now
  });

  await hooks.fire('user', 'update', userId);

  return { phoneVerified: true };
}

function shapeProfile(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phoneNumber: user.phoneNumber,
    phoneVerified: user.phoneVerified,
    profilePicUrl: user.profilePicUrl,
    isActivated: user.isActivated
  };
}

async function getProfile(userId) {
  const user = await User.query().findById(userId);
  if (!user) throw new Error('User not found');
  return shapeProfile(user);
}

/**
 * Update the current user's own name/phoneNumber/email. Changing phoneNumber
 * clears phoneVerified (same rule as requestPhoneOtp — a new number needs its
 * own verification). Changing email re-checks uniqueness (same as register())
 * but does NOT require re-activation — that's a bigger flow this doesn't touch.
 */
async function updateProfile(userId, fields) {
  const user = await User.query().findById(userId);
  if (!user) throw new Error('User not found');

  const data = {};

  if (fields.name !== undefined) {
    data.name = fields.name;
  }

  if (fields.phoneNumber !== undefined && fields.phoneNumber !== user.phoneNumber) {
    data.phoneNumber = fields.phoneNumber;
    data.phoneVerified = false;
  }

  if (fields.email !== undefined) {
    const email = fields.email.trim().toLowerCase();
    if (email !== user.email) {
      const normalized = normalizeEmail(email);
      const existing = await User.query().findOne({ normalizedEmail: normalized });
      if (existing && existing.id !== userId) {
        throw new Error('Email already in use');
      }
      data.email = email;
      data.normalizedEmail = normalized;
    }
  }

  data.recordModifiedDate = formatDbDateTime();

  await User.query().findById(userId).patch(data);
  await hooks.fire('user', 'update', userId);

  const updated = await User.query().findById(userId);
  return shapeProfile(updated);
}

/**
 * Store an already-uploaded avatar's path/URL on the user's profile. The
 * upload itself happens in the router via @xeplr/utils's FileUploader — this
 * just persists the result, same as any other profile field.
 */
async function setProfilePic(userId, profilePicUrl) {
  await User.query().findById(userId).patch({
    profilePicUrl: profilePicUrl,
    recordModifiedDate: formatDbDateTime()
  });
  await hooks.fire('user', 'update', userId);
  const updated = await User.query().findById(userId);
  return shapeProfile(updated);
}

/**
 * Self-service password change for an already-authenticated user (distinct
 * from resetPassword, which is for a user who's locked out and uses an
 * emailed token instead of their current session). Requires the current
 * password. Destroys all other sessions afterward — same as resetPassword —
 * so the caller should expect to need to log back in.
 */
async function changePassword(userId, { oldPassword, newPassword }) {
  if (!oldPassword || !newPassword) throw new Error('oldPassword and newPassword are required');

  const user = await User.query().findById(userId);
  if (!user) throw new Error('User not found');

  const isMatch = await comparePassword(oldPassword, user.pwd);
  if (!isMatch) throw new Error('Current password is incorrect');

  const { hash, salt } = await hashPassword(newPassword);

  await User.query().findById(userId).patch({
    pwd: hash,
    pwdSalt: salt,
    recordModifiedDate: formatDbDateTime()
  });

  await destroyAllUserSessions(userId);
  await clearUserAccess(userId);

  await hooks.fire('user', 'update', userId);
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
  resetPassword,
  requestPhoneOtp,
  verifyPhoneOtp,
  getProfile,
  updateProfile,
  setProfilePic,
  changePassword
};

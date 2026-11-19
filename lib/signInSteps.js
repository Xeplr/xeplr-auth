/**
 * SIGNING IN WITH A CODE, AND THE SECOND STEP.
 *
 * Two things, sharing one code store (@xeplr/utils otp, in Redis) and one
 * idea: a code proves you hold an inbox, a phone, or an authenticator app.
 *
 *   1. A code INSTEAD of a password — AUTH_LOGIN_METHODS email_otp / phone_otp.
 *      The address or number finds an EXISTING account; a code never creates
 *      one. A mobile number counts only once it is verified on the account
 *      (from the profile), so nobody can type someone else's number onto their
 *      own account and sign in as them — and a verified number belongs to one
 *      account only.
 *
 *   2. A code AFTER the first step (two-factor) — AUTH_2FA off | optional |
 *      required, AUTH_2FA_METHODS authenticator,email,sms. The first step
 *      gives a short-lived ticket instead of tokens; the second step turns the
 *      ticket into tokens. EMAIL IS ALWAYS OFFERED: someone who cannot open
 *      their authenticator app can have a code mailed instead. An admin can
 *      reset a person's second step (POST /admin/users/:id/two-factor/reset).
 *
 * The second step never asks again for what the first step already proved:
 * signing in with an emailed code does not then mail another one. When
 * nothing else is set up, the sign-in code counts.
 *
 * "Trust this device" (AUTH_2FA_TRUST_DAYS, 0 = never offered): the device
 * keeps a random token; Redis keeps its hash, the user and when their second
 * step last changed. An admin reset, or any change of method, makes every
 * trusted device ask again.
 */
var crypto = require('crypto');
var utils = require('@xeplr/utils');
var { encrypt, decrypt } = require('@xeplr/utils/isomorphic/crypto');
var { normalizeEmail } = require('@xeplr/utils/isomorphic');
var User = require('../models/User');
var { createSession } = require('./sessionService');
var { getUserAccess, clearUserAccess } = require('./accessService');
var hooks = require('./hooks');
var { refusal } = require('./userRoles');

var otp = utils.otp;
var totp = utils.totp;
var cache = utils.cache;

var LOGIN_METHODS = ['password', 'email_otp', 'phone_otp'];
var MODES = ['off', 'optional', 'required'];
var SECOND_METHODS = ['authenticator', 'email', 'sms'];

var TICKET_SECONDS = 600;          // first step → second step
var SETUP_SECONDS = 900;           // authenticator scanned → first code typed
var MAX_TICKET_TRIES = 5;          // wrong authenticator codes on one ticket
var CODES_PER_WINDOW = 5;          // codes sent to one person …
var CODE_WINDOW_SECONDS = 900;     // … per 15 minutes
var APP_FAILS_PER_WINDOW = 10;     // wrong authenticator codes for one person, across sign-ins, per 15 minutes

// ── settings ─────────────────────────────────────────────────────────────

function list(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback.slice();
  return String(raw).split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
}

function invalid(name, value, allowed) {
  return refusal('AUTH_SETTING_INVALID', name + ' has "' + value + '"; allowed: ' + allowed.join(', '));
}

/**
 * The sign-in settings, read at call time. Throws on a value it does not know,
 * naming the variable — a typo must not quietly turn the second step off.
 */
function settings() {
  var login = list(process.env.AUTH_LOGIN_METHODS, ['password']);
  login.forEach(function(m) { if (LOGIN_METHODS.indexOf(m) === -1) throw invalid('AUTH_LOGIN_METHODS', m, LOGIN_METHODS); });
  if (!login.length) throw refusal('AUTH_SETTING_INVALID', 'AUTH_LOGIN_METHODS names no way to sign in');

  var mode = String(process.env.AUTH_2FA || 'off').trim().toLowerCase();
  if (MODES.indexOf(mode) === -1) throw invalid('AUTH_2FA', mode, MODES);

  var methods = list(process.env.AUTH_2FA_METHODS, ['authenticator', 'email']);
  methods.forEach(function(m) { if (SECOND_METHODS.indexOf(m) === -1) throw invalid('AUTH_2FA_METHODS', m, SECOND_METHODS); });
  if (methods.indexOf('email') === -1) methods.push('email');   // always the way back in

  var rawDays = process.env.AUTH_2FA_TRUST_DAYS;
  var trustDays = rawDays === undefined || String(rawDays).trim() === '' ? 0 : Number(rawDays);
  if (!(trustDays >= 0) || Math.floor(trustDays) !== trustDays) {
    throw refusal('AUTH_SETTING_INVALID', 'AUTH_2FA_TRUST_DAYS must be a whole number of days (0 = never trust a device), not "' + rawDays + '"');
  }

  return { login: login, mode: mode, methods: methods, trustDays: trustDays };
}

/** Whether these settings send text messages — and so need an SMS provider. */
function needsSms(s) {
  return s.login.indexOf('phone_otp') !== -1 || (s.mode !== 'off' && s.methods.indexOf('sms') !== -1);
}

/**
 * At start: the settings parse, and what they need exists. An SMS provider is
 * registered by the host (@xeplr/utils sms.register) before boot(); without
 * one, a code by text cannot go out, so the server refuses to start rather
 * than have the first person to try it find out.
 */
function checkSettings() {
  var s = settings();
  if (needsSms(s) && !utils.sms.getProviders().length) {
    throw refusal('SMS_NOT_SET_UP', 'Signing in by text message is turned on (' +
      (s.login.indexOf('phone_otp') !== -1 ? 'AUTH_LOGIN_METHODS has phone_otp' : 'AUTH_2FA_METHODS has sms') +
      ') but no SMS provider is registered. Register one with @xeplr/utils sms.register() before boot(), or remove it.');
  }
  return s;
}

/** What the sign-in page needs to know — public, nothing about any account. */
function signInOptions() {
  var s = settings();
  return { methods: s.login, twoFactor: s.mode, twoFactorMethods: s.methods, trustDays: s.trustDays };
}

function requireLoginMethod(s, method, words) {
  if (s.login.indexOf(method) === -1) throw refusal('METHOD_OFF', words + ' is turned off on this server');
}

// ── phone numbers ────────────────────────────────────────────────────────

/** "+91 98765-43210" → "+919876543210": a leading + and the digits. */
function cleanPhone(typed) {
  var t = String(typed || '').trim();
  var digits = t.replace(/\D/g, '');
  if (!digits) return '';
  return (t.charAt(0) === '+' ? '+' : '') + digits;
}

var PHONE_SQL = 'regexp_replace("phoneNumber", \'[^0-9+]\', \'\', \'g\')';
var DIGITS_SQL = 'regexp_replace("phoneNumber", \'[^0-9]\', \'\', \'g\')';

function verifiedPhones() {
  return User.query().where('phoneVerified', true).whereNotNull('phoneNumber');
}

/**
 * The one account whose VERIFIED number this is. Typed with its country code,
 * it must match exactly; typed without (9876543210), it matches a number that
 * ends with those digits — and only when exactly one account does.
 */
async function findByVerifiedPhone(typed) {
  var p = cleanPhone(typed);
  if (!p) return null;
  var exact = await verifiedPhones().whereRaw(PHONE_SQL + ' = ?', [p]).withGraphFetched('roles');
  if (exact.length === 1) return exact[0];
  if (exact.length > 1 || p.charAt(0) === '+' || p.length < 10) return null;
  var ending = await verifiedPhones().whereRaw(DIGITS_SQL + ' LIKE ?', ['%' + p]).withGraphFetched('roles');
  return ending.length === 1 ? ending[0] : null;
}

/** Another account already holds this number, verified. */
async function phoneTakenByOther(userId, number) {
  var p = cleanPhone(number);
  if (!p) return false;
  var others = await verifiedPhones().whereRaw(PHONE_SQL + ' = ?', [p]).whereNot('id', userId).select('id');
  return others.length > 0;
}

// ── showing where a code went, without saying all of it ─────────────────

function maskEmail(email) {
  var parts = String(email || '').split('@');
  if (parts.length !== 2) return '';
  return parts[0].charAt(0) + '•••@' + parts[1];
}

function maskPhone(phone) {
  var d = String(phone || '').replace(/\D/g, '');
  return d ? '•••' + d.slice(-4) : '';
}

function sentTo(user, method) {
  if (method === 'email') return maskEmail(user.email);
  if (method === 'sms') return maskPhone(user.phoneNumber);
  return '';
}

// ── sending a code ───────────────────────────────────────────────────────

var _sendLimiter = null;
function sendLimiter() {
  if (!_sendLimiter) _sendLimiter = new utils.RateLimiter({ windowInSeconds: CODE_WINDOW_SECONDS, max: CODES_PER_WINDOW, store: 'redis' });
  return _sendLimiter;
}

/** Five codes per person per 15 minutes, whichever way they go. */
async function countSend(userId) {
  var key = 'auth-codes:' + userId;
  var wait = await sendLimiter().lockedFor(key);
  if (wait > 0) {
    throw refusal('TOO_MANY_CODES', 'Too many codes asked for. Try again in ' + Math.ceil(wait / 60) + ' minute' + (wait > 60 ? 's' : '') + '.');
  }
  await sendLimiter().fail(key);
}

// Wrong authenticator codes for one PERSON, across every sign-in: someone who
// has the password can start as many sign-ins as they like, each with its own
// five tries — this is what bounds the guessing.
var _appFails = null;
function appFails() {
  if (!_appFails) _appFails = new utils.RateLimiter({ windowInSeconds: CODE_WINDOW_SECONDS, max: APP_FAILS_PER_WINDOW, store: 'redis' });
  return _appFails;
}

function lockedOut(wait) {
  return refusal('TOO_MANY_TRIES', 'Too many wrong codes. Try again in ' + Math.ceil(wait / 60) + ' minute' + (wait > 60 ? 's' : '') + ', or ask for a code by email.');
}

function codeEmail(code, why) {
  return '<h2>' + why + '</h2>'
    + '<p>Your code is:</p>'
    + '<p style="font-size:28px;letter-spacing:6px;font-weight:bold">' + code + '</p>'
    + '<p>It works once, for 5 minutes. If you did not try to sign in, ignore this email — and consider changing your password.</p>';
}

/** One code under `key`, to the person's email or verified phone. */
async function sendCode(key, method, user) {
  if (method === 'email') {
    return otp.requestOtp(key, {
      send: async function(code) {
        try {
          await utils.sendEmail(user.email, 'Your sign-in code: ' + code, codeEmail(code, 'Your sign-in code'));
        } catch (err) {
          var e = refusal('EMAIL_SEND_FAILED', 'Could not send the code by email: ' + err.message);
          e.cause = err;
          throw e;
        }
      }
    });
  }
  if (method === 'sms') return otp.requestOtp(key, { to: cleanPhone(user.phoneNumber) });
  throw refusal('BAD_METHOD', 'Codes are sent by email or text message, not "' + method + '"');
}

function codeRefusal(reason) {
  if (reason === 'too_many_attempts') return refusal('TOO_MANY_TRIES', 'Too many wrong codes. Ask for a new one.');
  if (reason === 'expired') return refusal('CODE_EXPIRED', 'That code has expired or was already used. Ask for a new one.');
  return refusal('BAD_CODE', 'That code is not right.');
}

// ── the session at the end of every way in ───────────────────────────────

async function issueSession(user) {
  var full = user.roles ? user : await User.query().findById(user.id).withGraphFetched('roles');
  var tokenUser = {
    id: full.id,
    email: full.email,
    name: full.name,
    roles: (full.roles || []).map(function(r) { return r.name; })
  };
  var pair = await createSession(tokenUser);
  await clearUserAccess(full.id);
  var access = await getUserAccess(full.id);
  await hooks.fire('user', 'login', full.id);
  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    user: { id: full.id, email: full.email, name: full.name, isActivated: full.isActivated },
    access: access
  };
}

function canSignIn(user) {
  return Boolean(user && user.isActive && user.isActivated);
}

// ── the second step ──────────────────────────────────────────────────────

/**
 * Which second steps this person may use, after a first step that used
 * `used` ('password', 'email', 'sms'); null when none is asked.
 */
function secondStepFor(user, used, s) {
  if (s.mode === 'off') return null;
  if (s.mode === 'optional' && !user.twoFactorMethod) return null;
  var have = [];
  if (s.methods.indexOf('authenticator') !== -1 && user.totpSecret) have.push('authenticator');
  if (s.methods.indexOf('sms') !== -1 && user.phoneVerified && user.phoneNumber) have.push('sms');
  have.push('email');
  have = have.filter(function(m) { return m !== used; });
  if (!have.length) return null;
  var method = have.indexOf(user.twoFactorMethod) !== -1 ? user.twoFactorMethod : have[0];
  return { methods: have, method: method };
}

function stampOf(user) {
  return user.twoFactorChangedOn ? new Date(user.twoFactorChangedOn).getTime() : 0;
}

function trustKey(token) {
  return '2fa-trust:' + crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function trusted(user, token, s) {
  if (!token || !s.trustDays) return false;
  var rec = await cache.get(trustKey(token));
  return Boolean(rec && rec.userId === user.id && rec.stamp === stampOf(user));
}

async function trustThisDevice(user, s) {
  var token = crypto.randomBytes(32).toString('hex');
  await cache.set(trustKey(token), { userId: user.id, stamp: stampOf(user) }, s.trustDays * 86400);
  return token;
}

function ticketKey(ticket) { return '2fa-ticket:' + ticket; }
function codeKeyFor(ticket) { return '2fa:' + ticket; }

/**
 * After a first step that proved `used`: tokens, or — when a second step is
 * asked and this device is not trusted — a ticket for it. Sends the code
 * straight away when the second step is a code by email or text.
 */
async function afterFirstStep(user, used, trustToken) {
  var s = settings();
  var step = secondStepFor(user, used, s);
  if (!step || await trusted(user, trustToken, s)) return issueSession(user);

  var ticket = crypto.randomBytes(24).toString('hex');
  await cache.set(ticketKey(ticket), { userId: user.id, methods: step.methods, tries: 0 }, TICKET_SECONDS);
  if (step.method !== 'authenticator') {
    await countSend(user.id);
    await sendCode(codeKeyFor(ticket), step.method, user);
  }
  return {
    secondStep: {
      ticket: ticket,
      method: step.method,
      methods: step.methods,
      sentTo: sentTo(user, step.method),
      trustDays: s.trustDays
    }
  };
}

async function readTicket(ticket) {
  var t = ticket ? await cache.get(ticketKey(ticket)) : null;
  if (!t) throw refusal('SIGN_IN_EXPIRED', 'This sign-in has expired. Start again.');
  return t;
}

async function ticketUser(t) {
  var user = await User.query().findById(t.userId).withGraphFetched('roles');
  if (!canSignIn(user)) throw refusal('SIGN_IN_EXPIRED', 'This sign-in has expired. Start again.');
  return user;
}

/** Send (or send again) the second-step code, by email or text. */
async function sendSecondStepCode({ ticket, method }) {
  var t = await readTicket(ticket);
  if (t.methods.indexOf(method) === -1 || method === 'authenticator') {
    throw refusal('BAD_METHOD', 'A code cannot be sent that way for this sign-in');
  }
  var user = await ticketUser(t);
  await countSend(user.id);
  await sendCode(codeKeyFor(ticket), method, user);
  return { sent: true, method: method, sentTo: sentTo(user, method) };
}

async function readSecret(user) {
  return decrypt(user.totpSecret, process.env.ENCRYPTION_KEY);
}

/** An authenticator code is good once: the same six digits a second time are refused. */
async function usedBefore(userId, code) {
  var key = 'totp-used:' + userId + ':' + String(code).replace(/\s/g, '');
  if (await cache.get(key)) return true;
  await cache.set(key, { at: Date.now() }, 120);
  return false;
}

/** The second step's code → tokens (and, when asked for, a trusted-device token). */
async function verifySecondStep({ ticket, method, code, trustDevice }) {
  var s = settings();
  var t = await readTicket(ticket);
  if (t.methods.indexOf(method) === -1) throw refusal('BAD_METHOD', 'That way is not offered for this sign-in');
  var user = await ticketUser(t);

  if (method === 'authenticator') {
    var failKey = 'auth-app-fails:' + user.id;
    var wait = await appFails().lockedFor(failKey);
    if (wait > 0) throw lockedOut(wait);
    var ok = totp.verify(await readSecret(user), code);
    if (!ok || await usedBefore(user.id, code)) {
      var counted = await appFails().fail(failKey);
      if (counted.lockedFor > 0) {
        await cache.del(ticketKey(ticket));
        throw lockedOut(counted.lockedFor);
      }
      t.tries = (t.tries || 0) + 1;
      if (t.tries >= MAX_TICKET_TRIES) {
        await cache.del(ticketKey(ticket));
        throw refusal('TOO_MANY_TRIES', 'Too many wrong codes. Sign in again.');
      }
      await cache.set(ticketKey(ticket), t, TICKET_SECONDS);
      throw refusal('BAD_CODE', 'That code is not right. Use the one your authenticator app shows now.');
    }
    await appFails().reset(failKey);
  } else {
    var r = await otp.verifyOtp(codeKeyFor(ticket), code);
    if (!r.success) throw codeRefusal(r.reason);
  }

  await cache.del(ticketKey(ticket));
  await otp.cancelOtp(codeKeyFor(ticket));
  var session = await issueSession(user);
  if (trustDevice && s.trustDays) session.trustToken = await trustThisDevice(user, s);
  return session;
}

// ── signing in with a code instead of a password ─────────────────────────

async function accountFor({ email, phoneNumber }, s) {
  if (email) {
    requireLoginMethod(s, 'email_otp', 'Signing in with an emailed code');
    return User.query().findOne({ normalizedEmail: normalizeEmail(email) }).withGraphFetched('roles');
  }
  if (phoneNumber) {
    requireLoginMethod(s, 'phone_otp', 'Signing in with your mobile number');
    return findByVerifiedPhone(phoneNumber);
  }
  throw refusal('BAD_REQUEST', 'Email or mobile number is required');
}

/**
 * Send a sign-in code. The SAME answer whether or not an account matched —
 * it must not tell anyone which addresses or numbers have accounts.
 */
async function requestSignInCode({ email, phoneNumber }) {
  var s = settings();
  var user = await accountFor({ email: email, phoneNumber: phoneNumber }, s);
  if (!canSignIn(user)) return { sent: true };
  await countSend(user.id);
  await sendCode('signin:' + user.id, email ? 'email' : 'sms', user);
  return { sent: true };
}

async function verifySignInCode({ email, phoneNumber, code, trustToken }) {
  var s = settings();
  var user = await accountFor({ email: email, phoneNumber: phoneNumber }, s);
  if (!canSignIn(user)) throw codeRefusal('invalid');
  var r = await otp.verifyOtp('signin:' + user.id, code);
  if (!r.success) throw codeRefusal(r.reason);
  return afterFirstStep(user, email ? 'email' : 'sms', trustToken);
}

// ── my own second step (signed in) ───────────────────────────────────────

async function mine(userId) {
  var user = await User.query().findById(userId);
  if (!user) throw refusal('USER_NOT_FOUND', 'User not found');
  return user;
}

function statusOf(user, s) {
  return {
    mode: s.mode,
    methods: s.methods,
    method: user.twoFactorMethod || null,
    authenticator: Boolean(user.totpSecret),
    phoneNumber: user.phoneNumber || null,
    phoneVerified: Boolean(user.phoneVerified),
    trustDays: s.trustDays,
    signIn: s.login
  };
}

async function twoFactorStatus(userId) {
  return statusOf(await mine(userId), settings());
}

/** A new authenticator secret, held for 15 minutes until a code from the app confirms it. */
async function startAuthenticator(userId, issuer) {
  var s = settings();
  if (s.methods.indexOf('authenticator') === -1) throw refusal('METHOD_OFF', 'Authenticator apps are turned off on this server');
  var user = await mine(userId);
  var secret = totp.newSecret();
  await cache.set('totp-setup:' + userId, { secret: secret }, SETUP_SECONDS);
  var name = String(issuer || '').trim().slice(0, 60) || 'Xeplr';
  return { secret: secret, otpauthUrl: totp.otpauthUrl(secret, user.email, name) };
}

async function changed(userId, patch) {
  var now = utils.formatDbDateTime();
  await User.query().findById(userId).patch(Object.assign({ twoFactorChangedOn: now, recordModifiedDate: now }, patch));
  await hooks.fire('user', 'update', userId);
}

async function confirmAuthenticator(userId, code) {
  var held = await cache.get('totp-setup:' + userId);
  if (!held) throw refusal('SETUP_EXPIRED', 'Setting up took too long. Start again.');
  if (!totp.verify(held.secret, code)) {
    throw refusal('BAD_CODE', 'That code is not right. Check the app shows this account, and that the phone sets its time automatically.');
  }
  var stored = await encrypt(held.secret, process.env.ENCRYPTION_KEY);
  await changed(userId, { totpSecret: stored, twoFactorMethod: 'authenticator' });
  await cache.del('totp-setup:' + userId);
  return twoFactorStatus(userId);
}

/** Choose the second step ('authenticator', 'email', 'sms'), or turn it off (null). */
async function chooseMethod(userId, method) {
  var s = settings();
  var user = await mine(userId);
  if (!method || method === 'off') {
    if (s.mode === 'required') throw refusal('REQUIRED', 'The second step is required on this server; choose how, it cannot be turned off');
    await changed(userId, { twoFactorMethod: null });
    return twoFactorStatus(userId);
  }
  if (s.methods.indexOf(method) === -1) throw refusal('METHOD_OFF', '"' + method + '" is not offered on this server');
  if (method === 'authenticator' && !user.totpSecret) throw refusal('NOT_SET_UP', 'Set up the authenticator app first');
  if (method === 'sms' && !(user.phoneVerified && user.phoneNumber)) throw refusal('NOT_SET_UP', 'Verify your mobile number first');
  await changed(userId, { twoFactorMethod: method });
  return twoFactorStatus(userId);
}

/** An admin clears someone's second step: no method, no authenticator; trusted devices ask again. */
async function resetTwoFactor(userId, adminId) {
  await mine(userId);
  await changed(userId, { twoFactorMethod: null, totpSecret: null, recordModifiedBy: adminId || null });
  return { reset: true };
}

module.exports = {
  settings: settings,
  checkSettings: checkSettings,
  signInOptions: signInOptions,
  requireLoginMethod: requireLoginMethod,
  cleanPhone: cleanPhone,
  findByVerifiedPhone: findByVerifiedPhone,
  phoneTakenByOther: phoneTakenByOther,
  issueSession: issueSession,
  afterFirstStep: afterFirstStep,
  sendSecondStepCode: sendSecondStepCode,
  verifySecondStep: verifySecondStep,
  requestSignInCode: requestSignInCode,
  verifySignInCode: verifySignInCode,
  twoFactorStatus: twoFactorStatus,
  startAuthenticator: startAuthenticator,
  confirmAuthenticator: confirmAuthenticator,
  chooseMethod: chooseMethod,
  resetTwoFactor: resetTwoFactor
};

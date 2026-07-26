// Boundary tests for the pure token decision. These are the edges that used to
// bite intermittently — now they're assertions, not production surprises.
// Run: node --test test/tokenDecision.test.js

var test = require('node:test');
var assert = require('node:assert');
var { decide } = require('../lib/tokenDecision');

var NOW = 1_000_000;          // arbitrary "current time" in UNIX seconds
var TOL = 120;                // 2-minute tolerance

function base(over) {
  return Object.assign({ now: NOW, toleranceSeconds: TOL, sessionLive: true, signatureValid: true }, over);
}

// ── the happy path ──
test('valid token (not expired) → ok', function () {
  assert.deepStrictEqual(decide(base({ exp: NOW + 300 })), { action: 'ok', reason: 'valid' });
});

test('exactly at expiry (now === exp) → still ok (inclusive)', function () {
  assert.strictEqual(decide(base({ exp: NOW })).action, 'ok');
});

// ── the sliding refresh window ──
test('expired but within tolerance → slide (serve + refresh)', function () {
  assert.deepStrictEqual(decide(base({ exp: NOW - 30 })), { action: 'slide', reason: 'within-tolerance' });
});

test('exactly at the tolerance edge (now === exp + tolerance) → slide (inclusive)', function () {
  assert.strictEqual(decide(base({ exp: NOW - TOL })).action, 'slide');
});

test('one second past the tolerance edge → reject (the cliff, made explicit)', function () {
  assert.deepStrictEqual(decide(base({ exp: NOW - TOL - 1 })), { action: 'reject', reason: 'expired' });
});

// ── revocation is NEVER graced ──
test('revoked session, token still valid → reject (logout must be instant)', function () {
  assert.deepStrictEqual(decide(base({ exp: NOW + 300, sessionLive: false })), { action: 'reject', reason: 'revoked' });
});

test('revoked session, within tolerance → reject (never grace a revoke)', function () {
  assert.strictEqual(decide(base({ exp: NOW - 30, sessionLive: false })).reason, 'revoked');
});

// ── signature is checked first ──
test('bad signature → reject even if not expired and live', function () {
  assert.deepStrictEqual(decide(base({ exp: NOW + 300, signatureValid: false })), { action: 'reject', reason: 'bad-signature' });
});

test('bad signature outranks revoked (checked first)', function () {
  assert.strictEqual(decide(base({ exp: NOW + 300, signatureValid: false, sessionLive: false })).reason, 'bad-signature');
});

// ── strict mode (tolerance 0) = current/back-compat behavior ──
test('tolerance 0: one second expired → reject (no grace)', function () {
  assert.deepStrictEqual(decide(base({ exp: NOW - 1, toleranceSeconds: 0 })), { action: 'reject', reason: 'expired' });
});

test('tolerance 0: exactly at expiry → still ok', function () {
  assert.strictEqual(decide(base({ exp: NOW, toleranceSeconds: 0 })).action, 'ok');
});

test('default tolerance (omitted) is 0 → strict', function () {
  var r = decide({ exp: NOW - 1, now: NOW, sessionLive: true, signatureValid: true });
  assert.strictEqual(r.action, 'reject');
});

// ── clock skew tolerance (client slightly ahead of server) ──
test('now slightly before exp (client ahead) → ok', function () {
  assert.strictEqual(decide(base({ exp: NOW + 2 })).action, 'ok');
});

// ── malformed ──
test('missing exp → reject (malformed)', function () {
  assert.deepStrictEqual(decide(base({ exp: undefined })), { action: 'reject', reason: 'no-expiry' });
});

test('non-numeric exp → reject', function () {
  assert.strictEqual(decide(base({ exp: 'nope' })).reason, 'no-expiry');
});

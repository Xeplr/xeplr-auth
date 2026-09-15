// REDIS_PREFIX is required and may not be the shared default — see
// lib/redisPrefix.js for what two apps on one Redis did to each other.
// Run: node --test test/redisPrefix.test.js

var test = require('node:test');
var assert = require('node:assert');
var { redisPrefix } = require('../lib/redisPrefix');

test('a prefix of its own → used as given', function () {
  assert.strictEqual(redisPrefix({ REDIS_PREFIX: 'yyan:' }), 'yyan:');
});

test('surrounding whitespace from an env file → trimmed', function () {
  assert.strictEqual(redisPrefix({ REDIS_PREFIX: '  yyan:  ' }), 'yyan:');
});

test('unset → refused, naming the variable', function () {
  assert.throws(function () { redisPrefix({}); }, /REDIS_PREFIX is not set/);
});

test('blank → refused the same as unset', function () {
  assert.throws(function () { redisPrefix({ REDIS_PREFIX: '   ' }); }, /REDIS_PREFIX is not set/);
});

test('the shared default, written out → still refused', function () {
  assert.throws(function () { redisPrefix({ REDIS_PREFIX: 'xeplr:' }); }, /the value every app shares/);
});

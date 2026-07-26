// Pure token decision — NO I/O, NO side effects. This is the heart of the
// tolerance-refresh scheme, deliberately isolated so its edges are covered by
// tests instead of discovered in production. The middleware does the I/O
// (verify signature, look up the session) and hands the facts to decide().
//
//   decide({ exp, now, toleranceSeconds, sessionLive, signatureValid })
//     → { action, reason }
//
//   action:
//     'ok'     → token is valid; serve normally
//     'slide'  → token expired but within tolerance; serve AND issue a fresh
//                token (attach it to the response) — the sliding refresh
//     'reject' → do not serve (401)
//
//   inputs (all plain values — that's the point):
//     exp              token expiry, UNIX seconds (JWT `exp`)
//     now              current time, UNIX seconds
//     toleranceSeconds grace past expiry during which an expired token is still
//                      honored + refreshed. 0 = strict (reject on expiry).
//     sessionLive      is the session still valid server-side (NOT logged
//                      out / revoked)?  A revoke is NEVER graced.
//     signatureValid   did the JWT signature verify?
//
// Order matters: signature → revocation → expiry. A bad signature or a revoked
// session is rejected regardless of the clock; only a validly-signed, live
// session gets the tolerance grace.

function decide(input) {
  input = input || {};
  var exp = input.exp;
  var now = input.now;
  var tolerance = input.toleranceSeconds || 0;

  if (!input.signatureValid) return { action: 'reject', reason: 'bad-signature' };
  if (!input.sessionLive)    return { action: 'reject', reason: 'revoked' };        // never grace a revoke
  if (typeof exp !== 'number' || typeof now !== 'number') {
    return { action: 'reject', reason: 'no-expiry' };
  }

  if (now <= exp)                 return { action: 'ok',    reason: 'valid' };
  if (now <= exp + tolerance)     return { action: 'slide', reason: 'within-tolerance' };
  return { action: 'reject', reason: 'expired' };
}

module.exports = { decide };

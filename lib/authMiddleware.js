const { decodeVerified, getToleranceSeconds } = require('./authHelper');
const { validateAccessToken, slideAccessToken } = require('./sessionService');
const { decide } = require('./tokenDecision');

// The ONE place token logic lives. Order (from tokenDecision): signature →
// revocation → expiry. Tolerance (ACCESS_TOKEN_TOLERANCE_SECONDS, default 0)
// turns on the sliding refresh: an expired-but-recent token is served AND a
// fresh token is attached to the response (X-New-Token), set BEFORE the handler
// runs so it rides every response path. With tolerance 0 this is exactly the
// old behavior (reject on expiry).
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];

  // Verify signature, ignore expiry (we decide on expiry ourselves).
  const { decoded, signatureValid } = decodeVerified(token);

  // Session liveness = the whitelist entry still exists (a logout deletes it).
  // The entry outlives the token by `tolerance`, so it's present during grace.
  const session = signatureValid ? await validateAccessToken(token) : null;

  const decision = decide({
    exp: decoded && decoded.exp,
    now: Math.floor(Date.now() / 1000),
    toleranceSeconds: getToleranceSeconds(),
    sessionLive: !!session,
    signatureValid: signatureValid
  });

  if (decision.action === 'reject') {
    if (req.log) req.log.debug('auth reject: ' + decision.reason);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (decision.action === 'slide') {
    // Serve the request but hand back a fresh token. Header set BEFORE next()
    // → present on every response. A slide failure must not block a live
    // session — fall through and serve with the (still-tolerated) old token.
    try {
      const newToken = await slideAccessToken(token, decoded);
      if (newToken) {
        res.setHeader('X-New-Token', newToken);
        res.setHeader('Access-Control-Expose-Headers', 'X-New-Token');
      }
    } catch (err) {
      if (req.log) req.log.error('slide failed: ' + err.message);
    }
  }

  req.user = decoded;
  next();
}

module.exports = authMiddleware;

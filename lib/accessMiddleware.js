const { verifyToken } = require('./authHelper');
const accessService = require('./accessService');
const { getApiRule, userApiState } = accessService;

/**
 * Access-aware middleware.
 * Uses Redis-cached API rules: isPublic → unmapped → the user's state.
 * Only 'enabled' goes through; 'disabled' and 'hidden' are refused, each with
 * its own code so a UI can tell them apart.
 *
 * Usage:
 *   app.use('/api', accessMiddleware());
 *
 * Options:
 *   apiNameResolver(req) - function that returns the API name to check.
 *                          Defaults to req.baseUrl + req.path (e.g. "/api/orders")
 */
function accessMiddleware(options = {}) {
  const resolveApiName = options.apiNameResolver || ((req) => {
    return (req.baseUrl + req.path).replace(/\/+$/, '') || '/';
  });

  return async function(req, res, next) {
    const apiName = resolveApiName(req);

    // Single cached lookup for API rule (public flag + role IDs)
    const rule = await getApiRule(apiName);

    // Not in DB, or marked public, or no role mappings = open
    if (!rule.exists || rule.isPublic || rule.unmapped) return next();

    // From here, auth is required
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = decoded;

    // The user's state for this API (also cached)
    var state = await userApiState(decoded.id, apiName);
    if (state === 'enabled') return next();
    if (state === 'disabled') {
      return res.status(403).json({ error: 'This is disabled for you', code: 'DISABLED' });
    }
    return res.status(403).json({ error: 'Access denied', code: 'HIDDEN' });
  };
}

/**
 * The access check for auth's OWN routes, in-process. The same answer the
 * other apps get from GET /verify: the catalog row this request matches
 * (method, path, :params), then the user's state for it. Mount after the
 * token check, so req.user is set.
 *
 * Refuses on error: "cannot tell" is never "allowed".
 */
function accessGate() {
  return async function(req, res, next) {
    var path = (req.baseUrl || '') + (req.path || '');
    var answer;
    try {
      answer = await accessService.requestApiState(req.user && req.user.id, req.method, path);
    } catch (err) {
      if (req.log) req.log.error('access check failed: ' + err.message);
      return res.status(503).json({ error: 'Access rules are unavailable; try again shortly' });
    }
    if (answer.state === 'enabled') return next();
    if (answer.state === 'disabled') {
      return res.status(403).json({ error: 'This is disabled for you', code: 'DISABLED' });
    }
    return res.status(403).json({ error: 'Access denied', code: 'HIDDEN' });
  };
}

/**
 * Simple role-check middleware (no DB lookup, uses roles from JWT or req.user).
 * Use after authMiddleware.
 *
 * Usage:
 *   app.use('/admin', authMiddleware, requireRole('admin'));
 */
function requireRole(...roles) {
  return function(req, res, next) {
    if (!req.user || !req.user.roles) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [];
    const hasRole = roles.some(r => userRoles.includes(r));

    if (!hasRole) {
      return res.status(403).json({ error: 'Access denied' });
    }

    next();
  };
}

module.exports = { accessMiddleware, accessGate, requireRole };

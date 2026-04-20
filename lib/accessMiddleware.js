const { verifyToken } = require('./authHelper');
const { getApiRule, userHasApiAccess } = require('./accessService');

/**
 * Access-aware middleware.
 * Uses Redis-cached API rules: isPublic → unmapped → role check.
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

    // Check role-based access (also cached)
    const hasAccess = await userHasApiAccess(decoded.id, apiName);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    next();
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

module.exports = { accessMiddleware, requireRole };

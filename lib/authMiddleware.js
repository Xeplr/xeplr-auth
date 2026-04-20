const { verifyToken } = require('./authHelper');
const { validateAccessToken } = require('./sessionService');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  // Step 1: Verify JWT signature + expiry
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Step 2: Check Redis whitelist (token not revoked)
  const session = await validateAccessToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Session expired or revoked' });
  }

  req.user = decoded;
  next();
}

module.exports = authMiddleware;

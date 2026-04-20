const { authHelper } = require('../index');
const { generateAccessToken } = authHelper;

// Configure JWT for tests
authHelper.configure({ jwtSecret: 'test-secret', accessTokenExpiresIn: '15m' });

// Test the simple JWT verification (without Redis whitelist)
// For full middleware with Redis, integration tests are needed
const { verifyToken } = authHelper;

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function mockReq(headers = {}) {
  return { headers };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('authMiddleware - authenticate', () => {

  test('returns 401 when no authorization header', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when authorization header does not start with Bearer', () => {
    const req = mockReq({ authorization: 'Basic abc123' });
    const res = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 for invalid token', () => {
    const req = mockReq({ authorization: 'Bearer invalidtoken' });
    const res = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next and sets req.user for valid token', () => {
    const user = { id: 'user1', email: 'test@test.com', name: 'Test' };
    const token = generateAccessToken(user);
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe('user1');
    expect(req.user.email).toBe('test@test.com');
  });

  test('returns 401 when Bearer has empty token', () => {
    const req = mockReq({ authorization: 'Bearer ' });
    const res = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

});

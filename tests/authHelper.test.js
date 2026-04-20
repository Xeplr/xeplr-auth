const { authHelper } = require('../index');
const { generateId, hashPassword, comparePassword, generateAccessToken, verifyToken } = authHelper;

// Configure JWT for tests
authHelper.configure({ jwtSecret: 'test-secret', accessTokenExpiresIn: '15m' });

describe('authHelper', () => {

  describe('generateId', () => {
    test('returns a string of length 24', () => {
      const id = generateId();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(24);
    });

    test('returns unique ids on successive calls', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });

    test('contains only hex characters', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('hashPassword', () => {
    test('returns an object with hash and salt', async () => {
      const result = await hashPassword('testPassword123');
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('salt');
      expect(typeof result.hash).toBe('string');
      expect(typeof result.salt).toBe('string');
    });

    test('hash is different from plain password', async () => {
      const password = 'myPassword';
      const { hash } = await hashPassword(password);
      expect(hash).not.toBe(password);
    });

    test('different calls produce different hashes', async () => {
      const { hash: hash1 } = await hashPassword('samePassword');
      const { hash: hash2 } = await hashPassword('samePassword');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('comparePassword', () => {
    test('returns true for matching password', async () => {
      const password = 'correctPassword';
      const { hash } = await hashPassword(password);
      const result = await comparePassword(password, hash);
      expect(result).toBe(true);
    });

    test('returns false for wrong password', async () => {
      const { hash } = await hashPassword('correctPassword');
      const result = await comparePassword('wrongPassword', hash);
      expect(result).toBe(false);
    });
  });

  describe('generateAccessToken', () => {
    test('returns a JWT string', () => {
      const user = { id: 'abc123', email: 'test@test.com', name: 'Test' };
      const token = generateAccessToken(user);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    test('token contains user data', () => {
      const user = { id: 'abc123', email: 'test@test.com', name: 'Test' };
      const token = generateAccessToken(user);
      const decoded = verifyToken(token);
      expect(decoded.id).toBe('abc123');
      expect(decoded.email).toBe('test@test.com');
      expect(decoded.name).toBe('Test');
    });

    test('token does not include password fields', () => {
      const user = { id: 'abc123', email: 'test@test.com', name: 'Test', pwd: 'secret', pwdSalt: 'salt' };
      const token = generateAccessToken(user);
      const decoded = verifyToken(token);
      expect(decoded.pwd).toBeUndefined();
      expect(decoded.pwdSalt).toBeUndefined();
    });
  });

  describe('verifyToken', () => {
    test('decodes a valid token', () => {
      const user = { id: 'abc123', email: 'test@test.com', name: 'Test' };
      const token = generateAccessToken(user);
      const decoded = verifyToken(token);
      expect(decoded.id).toBe('abc123');
      expect(decoded).toHaveProperty('exp');
      expect(decoded).toHaveProperty('iat');
    });

    test('throws on invalid token', () => {
      expect(() => verifyToken('invalid.token.here')).toThrow();
    });

    test('throws on tampered token', () => {
      const user = { id: 'abc123', email: 'test@test.com', name: 'Test' };
      const token = generateAccessToken(user);
      const tampered = token.slice(0, -5) + 'XXXXX';
      expect(() => verifyToken(tampered)).toThrow();
    });
  });

});

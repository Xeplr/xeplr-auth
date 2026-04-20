const express = require('express');
const { register, activate, login, forgotPassword, resetPassword } = require('./authService');
const { getUserAccess } = require('./accessService');
const { getSession, rotateSession, destroySession } = require('./sessionService');
const authMiddleware = require('./authMiddleware');
const User = require('../models/User');

function logError(req, err) {
  if (req.log) req.log.error(err.message, { stack: err.stack });
}

function createAuthRouter(options = {}) {
  const router = express.Router();
  const resetBaseUrl = options.resetBaseUrl || null;

  router.post('/register', async function(req, res) {
    try {
      const { email, phoneNumber, name, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = await register({ email, phoneNumber, name, password });
      res.status(201).json({ message: 'Registration successful. Account pending activation.', user });
    } catch (err) {
      logError(req, err);
      if (err.message === 'Email already registered') {
        return res.status(409).json({ error: err.message });
      }
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  router.get('/activate', async function(req, res) {
    try {
      var token = req.query.token;
      if (!token) {
        return res.status(400).json({ error: 'Activation token is required' });
      }

      var result = await activate(token);
      res.json({ message: 'Account activated successfully', user: result });
    } catch (err) {
      logError(req, err);
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/login', async function(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const result = await login({ email, password });
      res.json(result);
    } catch (err) {
      logError(req, err);
      if (err.message === 'NOT_ACTIVATED') {
        return res.status(403).json({ error: 'Please wait, someone will activate you.' });
      }
      if (err.message === 'Invalid email or password' || err.message === 'Account is deactivated') {
        return res.status(401).json({ error: err.message });
      }
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  router.post('/forgot-password', async function(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      const baseUrl = resetBaseUrl || req.protocol + '://' + req.get('host');
      await forgotPassword({ email }, baseUrl);
      res.json({ message: 'If that email exists, a reset link has been sent.' });
    } catch (err) {
      logError(req, err);
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  router.post('/reset-password', async function(req, res) {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({ error: 'Token and new password are required' });
      }

      await resetPassword({ token, newPassword });
      res.json({ message: 'Password reset successful.' });
    } catch (err) {
      logError(req, err);
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/refresh', async function(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token is required' });
      }

      const session = await getSession(refreshToken);
      if (!session || !session.userId) {
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
      }

      const user = await User.query().findById(session.userId);
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Account not found or deactivated' });
      }

      const result = await rotateSession(refreshToken, user);
      if (!result) {
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
      }

      const access = await getUserAccess(user.id);

      res.json({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isActivated: user.isActivated
        },
        access
      });
    } catch (err) {
      logError(req, err);
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  router.post('/logout', async function(req, res) {
    try {
      const { refreshToken } = req.body;

      if (refreshToken) {
        await destroySession(refreshToken);
      }

      res.json({ message: 'Logged out successfully' });
    } catch (err) {
      logError(req, err);
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  router.get('/me', authMiddleware, async function(req, res) {
    try {
      const access = await getUserAccess(req.user.id);
      res.json({
        user: req.user,
        access
      });
    } catch (err) {
      logError(req, err);
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // Get tenants for the current logged-in user
  router.get('/my-tenants', authMiddleware, async function(req, res) {
    try {
      var user = await User.query().findById(req.user.id).withGraphFetched('tenants');
      var tenants = (user && user.tenants) ? user.tenants : [];
      res.json(tenants.map(function(t) {
        return { id: t.id, name: t.name, code: t.code, description: t.description };
      }));
    } catch (err) {
      logError(req, err);
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  return router;
}

module.exports = createAuthRouter;

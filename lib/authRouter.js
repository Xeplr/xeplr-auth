const express = require('express');
const FileUploader = require('@xeplr/utils/lib/fileUploader');
const { register, activate, previewInvite, acceptInvite, login, forgotPassword, resetPassword, requestPhoneOtp, verifyPhoneOtp, getProfile, updateProfile, setProfilePic, changePassword } = require('./authService');
const { getUserAccess } = require('./accessService');
const { getSession, rotateSession, destroySession } = require('./sessionService');
const { issueTicket } = require('./ticketService');
const authMiddleware = require('./authMiddleware');
const User = require('../models/User');

// Avatar uploads — local disk by default (FileUploader's own default:
// process.env.UPLOAD_DIR or ./uploads). Auth only persists the resulting
// path on the user; serving it back over HTTP is the consuming app's concern
// (same as any other uploaded asset), so wire a static route to the same
// directory wherever it makes sense for your deployment.
const avatarUploader = new FileUploader({ allowedTypes: ['image/*'], maxSize: 2 * 1024 * 1024 });

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

      // Carried in the activation LINK and handed straight back — see
      // authService.register. If a workflow is waiting on this person, this is
      // the key that releases it.
      var result = await activate(token, { workflowKey: req.query.workflowKey });
      res.json({ message: 'Account activated successfully', user: result });
    } catch (err) {
      logError(req, err);
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/invite-preview', async function(req, res) {
    try {
      var token = req.query.token;
      if (!token) return res.status(400).json({ error: 'Token is required' });
      var info = await previewInvite(token);
      res.json(info);
    } catch (err) {
      logError(req, err);
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/invite-accept', async function(req, res) {
    try {
      const { token, name, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ error: 'Token and password are required' });
      }
      const result = await acceptInvite({ token, name, password });
      res.json({ message: 'Invite accepted', user: result });
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

      const user = await User.query().findById(session.userId).withGraphFetched('roles');
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Account not found or deactivated' });
      }

      // Pack role names so refreshed tokens carry the same role claims as login.
      const tokenUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: (user.roles || []).map(function(r) { return r.name; })
      };

      const result = await rotateSession(refreshToken, tokenUser);
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

  router.get('/profile', authMiddleware, async function(req, res) {
    try {
      const profile = await getProfile(req.user.id);
      res.json(profile);
    } catch (err) {
      logError(req, err);
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/profile', authMiddleware, async function(req, res) {
    try {
      const profile = await updateProfile(req.user.id, req.body);
      res.json(profile);
    } catch (err) {
      logError(req, err);
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/profile/avatar', authMiddleware, ...avatarUploader.single('avatar'), async function(req, res) {
    try {
      if (!req.file) return res.status(400).json({ error: 'avatar file is required' });
      // Store just the generated filename — never the server's filesystem
      // path (leaks server layout, and isn't meaningful once you swap disk
      // storage for S3/etc). The app knows its own UPLOAD_DIR and however
      // it serves it; it builds the actual URL from this filename.
      const profile = await setProfilePic(req.user.id, req.file.filename);
      res.json(profile);
    } catch (err) {
      logError(req, err);
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/change-password', authMiddleware, async function(req, res) {
    try {
      const { oldPassword, newPassword } = req.body;
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'oldPassword and newPassword are required' });
      }
      await changePassword(req.user.id, { oldPassword, newPassword });
      res.json({ message: 'Password changed. Please log in again.' });
    } catch (err) {
      logError(req, err);
      res.status(400).json({ error: err.message });
    }
  });

  // Additive phone verification — like email activation, but for a phone
  // number attached to an already-authenticated account. Body: { phoneNumber }
  // optional (omit to re-send to the number already on file).
  router.post('/request-phone-otp', authMiddleware, async function(req, res) {
    try {
      const result = await requestPhoneOtp(req.user.id, req.body.phoneNumber);
      res.json(result);
    } catch (err) {
      logError(req, err);
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/verify-phone-otp', authMiddleware, async function(req, res) {
    try {
      if (!req.body.code) return res.status(400).json({ error: 'code is required' });
      const result = await verifyPhoneOtp(req.user.id, req.body.code);
      res.json(result);
    } catch (err) {
      logError(req, err);
      res.status(400).json({ error: err.message });
    }
  });

  // ── SSE ticket ────────────────────────────────────────────────────────
  //
  // Mints a short-lived, single-use ticket so a browser can open an
  // EventSource without leaking the primary session token in the URL.
  //
  // Body (optional):
  //   { scopes: [...] }   — client-requested scopes. If omitted, defaults
  //                         to the user's own namespace (['user:me:*']).
  //                         Whatever is minted here is what the SSE server
  //                         will enforce at subscribe time.
  //
  // NOTE the scopes are advisory intent — the SSE handler owns the final
  // authorization check (see xeplr-base-apis/lib/sse.js#createHandler).
  router.post('/sse-ticket', authMiddleware, async function(req, res) {
    try {
      var requested = (req.body && Array.isArray(req.body.scopes)) ? req.body.scopes : ['user:me:*'];
      var { ticket, expiresIn } = await issueTicket({
        userId: req.user.id,
        scopes: requested
      });
      res.json({ ticket: ticket, expiresIn: expiresIn });
    } catch (err) {
      logError(req, err);
      res.status(500).json({ error: 'Failed to mint SSE ticket' });
    }
  });

  return router;
}

module.exports = createAuthRouter;

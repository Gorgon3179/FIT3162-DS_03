// routes/auth.js
// Authentication: Monash email, bcrypt password/OTP, or Supabase Google OAuth
// App sessions still use auth_users + voters so the voting routes stay unchanged.

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db');
const { hashVoterId, generateVerificationCode, sendVerificationEmail } = require('../utils');
const { loginRateLimit, verifyRateLimit } = require('../middleware/ratelimit');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isMonashEmail(email) {
  return /^[^\s@]+@(student\.monash\.edu|monash\.edu)$/i.test(email.trim());
}

function isDevMode() {
  return process.env.DEV_MODE === 'true';
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code.trim()).digest('hex');
}

function setAuthCookie(res, user) {
  const token = jwt.sign(
    { voterHash: user.voter_hash, isAdmin: user.is_admin },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: '8h' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  });
}

function hasVerifiedEmail(user) {
  const isVerified = value => value === true || value === 'true';

  if (user.email_confirmed_at || user.confirmed_at) return true;
  if (isVerified(user.user_metadata?.email_verified)) return true;
  return (user.identities || []).some(identity => isVerified(identity.identity_data?.email_verified));
}

function hasGoogleIdentity(user) {
  if (user.app_metadata?.provider === 'google') return true;
  return (user.identities || []).some(identity => identity.provider === 'google');
}

async function getSupabaseUser(accessToken) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    const err = new Error('Supabase Auth is not configured.');
    err.status = 503;
    throw err;
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const err = new Error('Invalid Supabase session.');
    err.status = 401;
    throw err;
  }

  return response.json();
}

async function upsertOAuthUser(email) {
  const normalEmail = email.toLowerCase().trim();
  const existing = await query(
    'SELECT voter_hash, is_admin FROM auth_users WHERE email = $1',
    [normalEmail]
  );
  const isNewUser = existing.length === 0;
  const voterHash = existing[0]?.voter_hash || hashVoterId(normalEmail);

  await query(
    'INSERT INTO voters (voter_hash, salt) VALUES ($1, $2) ON CONFLICT (voter_hash) DO NOTHING',
    [voterHash, crypto.randomBytes(16).toString('hex')]
  );

  const users = await query(
    `INSERT INTO auth_users (email, password_hash, voter_hash, last_login_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (email) DO UPDATE
       SET voter_hash = EXCLUDED.voter_hash,
           last_login_at = NOW()
     RETURNING voter_hash, is_admin`,
    [normalEmail, '', voterHash]
  );

  return { ...users[0], isNewUser };
}

// ─── GET /api/auth/supabase-config ───────────────────────────────────────────
router.get('/supabase-config', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  res.json({
    enabled: Boolean(supabaseUrl && supabaseAnonKey),
    url: supabaseUrl || null,
    anonKey: supabaseAnonKey || null,
    devMode: isDevMode()
  });
});

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', loginRateLimit(), async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (!isMonashEmail(email)) {
      return res.status(400).json({ error: 'Only @student.monash.edu or @monash.edu emails are allowed.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const normalEmail = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 12);
    const voterHash = hashVoterId(normalEmail);
    const salt = crypto.randomBytes(16).toString('hex');

    // Check if email already registered
    const existing = await query('SELECT auth_user_id FROM auth_users WHERE email = $1', [normalEmail]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Insert into voters (anonymous identity)
    await query(
      'INSERT INTO voters (voter_hash, salt) VALUES ($1, $2) ON CONFLICT (voter_hash) DO NOTHING',
      [voterHash, salt]
    );

    // Insert into auth_users
    await query(
      'INSERT INTO auth_users (email, password_hash, voter_hash) VALUES ($1, $2, $3)',
      [normalEmail, passwordHash, voterHash]
    );

    res.status(201).json({ message: 'Account created. Please sign in to continue.' });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', loginRateLimit(), async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (!isMonashEmail(email)) {
      return res.status(400).json({ error: 'Only @student.monash.edu or @monash.edu emails are allowed.' });
    }

    const normalEmail = email.toLowerCase().trim();

    // Find user
    const users = await query(
      'SELECT auth_user_id, email, password_hash, voter_hash FROM auth_users WHERE email = $1',
      [normalEmail]
    );
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = users[0];
    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Generate and store verification code
    const code = generateVerificationCode();
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await query(
      'INSERT INTO verification_codes (email, code_hash, expires_at) VALUES ($1, $2, $3)',
      [normalEmail, codeHash, expiresAt]
    );

    // Update last login
    await query(
      'UPDATE auth_users SET last_login_at = NOW() WHERE auth_user_id = $1',
      [user.auth_user_id]
    );

    // Send email (or log in dev mode)
    await sendVerificationEmail(normalEmail, code);

    const response = { message: 'Verification code sent.' };
    if (process.env.DEV_MODE === 'true') {
      response.devCode = code;
    }

    res.json(response);
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── POST /api/auth/verify ────────────────────────────────────────────────────
router.post('/verify', verifyRateLimit(), async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required.' });
    }

    const normalEmail = email.toLowerCase().trim();
    const codeHash = hashCode(code);

    // Find valid, unused code
    const entries = await query(
      `SELECT verification_code_id, code_hash, expires_at
       FROM verification_codes
       WHERE email = $1 AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [normalEmail]
    );

    if (entries.length === 0) {
      return res.status(400).json({ error: 'No verification code found or it has expired. Please log in again.' });
    }

    const entry = entries[0];

    if (entry.code_hash !== codeHash) {
      return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    }

    // Mark code as used
    await query(
      'UPDATE verification_codes SET used_at = NOW() WHERE verification_code_id = $1',
      [entry.verification_code_id]
    );

    // Get user info + admin status
    const users = await query(
      'SELECT voter_hash, is_admin FROM auth_users WHERE email = $1',
      [normalEmail]
    );

    if (users.length === 0) {
      // Safety: insert voter if somehow missing
      const voterHash = hashVoterId(normalEmail);
      const salt = crypto.randomBytes(16).toString('hex');
      await query(
        'INSERT INTO voters (voter_hash, salt) VALUES ($1, $2) ON CONFLICT (voter_hash) DO NOTHING',
        [voterHash, salt]
      );
      // Also insert auth_users row
      await query(
        'INSERT INTO auth_users (email, password_hash, voter_hash, is_admin) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING',
        [normalEmail, '', voterHash, false]
      );
    }

    const user = users[0] || { voter_hash: hashVoterId(normalEmail), is_admin: false };

    // Ensure voter exists
    await query(
      'INSERT INTO voters (voter_hash, salt) VALUES ($1, $2) ON CONFLICT (voter_hash) DO NOTHING',
      [user.voter_hash, crypto.randomBytes(16).toString('hex')]
    );

    setAuthCookie(res, user);

    res.json({ message: 'Verified successfully.', voterHash: user.voter_hash });
  } catch (err) {
    console.error('[auth/verify]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── POST /api/auth/supabase ─────────────────────────────────────────────────
router.post('/supabase', loginRateLimit(), async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'Supabase access token is required.' });
    }

    const supabaseUser = await getSupabaseUser(accessToken);
    const email = supabaseUser.email?.toLowerCase().trim();

    if (!hasGoogleIdentity(supabaseUser)) {
      return res.status(403).json({ error: 'Google account is required.' });
    }
    if (!email || !hasVerifiedEmail(supabaseUser)) {
      return res.status(403).json({ error: 'Google account email must be verified.' });
    }
    if (!isMonashEmail(email)) {
      return res.status(403).json({ error: 'Only @student.monash.edu or @monash.edu Google accounts are allowed.' });
    }

    const user = await upsertOAuthUser(email);
    setAuthCookie(res, user);

    res.json({
      message: 'Signed in with Google.',
      voterHash: user.voter_hash,
      isNewUser: user.isNewUser
    });
  } catch (err) {
    console.error('[auth/supabase]', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error.' });
  }
});

// ─── POST /api/auth/dev-login ────────────────────────────────────────────────
router.post('/dev-login', loginRateLimit(), async (req, res) => {
  try {
    if (!isDevMode()) {
      return res.status(404).json({ error: 'Endpoint not found.' });
    }

    const email = (req.body?.email || 'demo@student.monash.edu').toLowerCase().trim();
    if (!isMonashEmail(email)) {
      return res.status(400).json({ error: 'Use a @student.monash.edu or @monash.edu test email.' });
    }

    const user = await upsertOAuthUser(email);
    setAuthCookie(res, user);

    res.json({
      message: 'Signed in with development account.',
      voterHash: user.voter_hash,
      isNewUser: user.isNewUser
    });
  } catch (err) {
    console.error('[auth/dev-login]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    res.json({
      voterHash: decoded.voterHash,
      isAdmin: decoded.isAdmin || false
    });
  } catch {
    res.status(401).json({ error: 'Session expired.' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out.' });
});

module.exports = router;

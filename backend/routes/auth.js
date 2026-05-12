// routes/auth.js
// Authentication: Monash email, bcrypt password, 6-digit verification code
// Uses auth_users + verification_codes tables (not Supabase Auth)

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

function hashCode(code) {
  return crypto.createHash('sha256').update(code.trim()).digest('hex');
}

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
    if (process.env.DEV_MODE === 'true' || !process.env.EMAIL_USER) {
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

    // Issue JWT
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

    res.json({ message: 'Verified successfully.', voterHash: user.voter_hash });
  } catch (err) {
    console.error('[auth/verify]', err);
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

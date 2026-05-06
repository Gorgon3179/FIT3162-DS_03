// routes/auth.js
// R1: Voter authentication - validates Monash email, no Okta required
// R3: One vote per user enforced via hashed voter ID

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { mem, isDev } = require('../db');
const { hashVoterId, generateVerificationCode, sendVerificationEmail } = require('../utils');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isMonashEmail(email) {
  return /^[^\s@]+@(student\.monash\.edu|monash\.edu)$/i.test(email.trim());
}

function findUser(email) {
  return mem.users.find(u => u.email === email.toLowerCase());
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
// R1: Only Monash emails allowed
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // R1: Monash email check
    if (!isMonashEmail(email)) {
      return res.status(400).json({ error: 'Only @student.monash.edu or @monash.edu emails are allowed.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const normalEmail = email.toLowerCase().trim();

    if (!isDev) {
      // TODO (your friend): INSERT INTO users (email, password_hash) VALUES ($1, $2)
      return res.status(501).json({ error: 'DB not configured yet.' });
    }

    if (findUser(normalEmail)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = mem.users.length + 1;

    mem.users.push({
      id,
      email: normalEmail,
      passwordHash,
      verified: false,
      createdAt: new Date().toISOString()
    });

    res.status(201).json({ message: 'Account created. Please sign in to continue.' });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// R1: Validates Monash email + password, then sends verification code
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    if (!isMonashEmail(email)) {
      return res.status(400).json({ error: 'Only @student.monash.edu or @monash.edu emails are allowed.' });
    }

    const normalEmail = email.toLowerCase().trim();

    if (!isDev) {
      // TODO (your friend): SELECT * FROM users WHERE email = $1
      return res.status(501).json({ error: 'DB not configured yet.' });
    }

    const user = findUser(normalEmail);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Generate and store verification code
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Remove any existing code for this email
    const idx = mem.verCodes.findIndex(v => v.email === normalEmail);
    if (idx !== -1) mem.verCodes.splice(idx, 1);
    mem.verCodes.push({ email: normalEmail, code, expiresAt });

    // Send (or log in dev mode)
    await sendVerificationEmail(normalEmail, code);

    const response = { message: 'Verification code sent.' };

    // In dev mode, return the code so the frontend can show it (for testing)
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
// Verifies the 6-digit code, returns a JWT
router.post('/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required.' });
    }

    const normalEmail = email.toLowerCase().trim();

    const entry = mem.verCodes.find(v => v.email === normalEmail);
    if (!entry) {
      return res.status(400).json({ error: 'No verification code found. Please log in again.' });
    }

    if (new Date() > new Date(entry.expiresAt)) {
      return res.status(400).json({ error: 'Verification code has expired. Please log in again.' });
    }

    if (entry.code !== code.trim()) {
      return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    }

    // Clean up the used code
    const idx = mem.verCodes.indexOf(entry);
    mem.verCodes.splice(idx, 1);

    // Mark user as verified
    const user = findUser(normalEmail);
    if (user) user.verified = true;

    // R2: Hash the voter ID for anonymity
    const voterHash = hashVoterId(normalEmail);

    // Issue JWT
    const token = jwt.sign(
      { userId: user ? user.id : null, email: normalEmail, voterHash },
      process.env.JWT_SECRET || 'dev_secret',
      { expiresIn: '8h' }
    );

    // Set as HTTP-only cookie (more secure than localStorage)
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000 // 8 hours
    });

    res.json({ message: 'Verified successfully.', voterHash });
  } catch (err) {
    console.error('[auth/verify]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
// Returns current user info if logged in
router.get('/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    res.json({ email: decoded.email, voterHash: decoded.voterHash });
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

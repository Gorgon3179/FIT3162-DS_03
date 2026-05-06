// routes/traits.js
// R8: Personal trait submission (before voting eligibility)
// Traits are stored against the voter's hash (anonymous)

const express = require('express');
const router = express.Router();
const { mem, isDev } = require('../db');
const { authenticate } = require('../middleware/auth');

// ─── POST /api/traits ─────────────────────────────────────────────────────────
// Submit or update voter traits
router.post('/', authenticate, (req, res) => {
  const { voterHash } = req.user;
  const { yearOfStudy, faculty, campus, countryOfOrigin, clubsJoined } = req.body;

  if (!isDev) {
    // TODO (your friend):
    // INSERT INTO voter_trait_responses (voter_hash, year_of_study, faculty, campus, country, clubs_joined)
    // ON CONFLICT (voter_hash) DO UPDATE SET ...
    return res.status(501).json({ error: 'DB not configured.' });
  }

  // Upsert traits
  const idx = mem.traits.findIndex(t => t.voterHash === voterHash);
  const record = { voterHash, yearOfStudy, faculty, campus, countryOfOrigin, clubsJoined, updatedAt: new Date().toISOString() };

  if (idx !== -1) {
    mem.traits[idx] = record;
  } else {
    mem.traits.push(record);
  }

  res.json({ message: 'Traits saved.' });
});

// ─── GET /api/traits ──────────────────────────────────────────────────────────
// Get current voter's traits
router.get('/', authenticate, (req, res) => {
  const { voterHash } = req.user;

  if (!isDev) {
    // TODO (your friend): SELECT * FROM voter_trait_responses WHERE voter_hash = $1
    return res.status(501).json({ error: 'DB not configured.' });
  }

  const traits = mem.traits.find(t => t.voterHash === voterHash);
  res.json(traits || null);
});

module.exports = router;

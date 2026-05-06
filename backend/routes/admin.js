// routes/admin.js
// Admin-only routes: create/update elections, view voter activity

const express = require('express');
const router = express.Router();
const { mem, isDev } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
router.get('/stats', authenticate, requireAdmin, (req, res) => {
  if (!isDev) return res.status(501).json({ error: 'DB not configured.' });

  const activeElections = mem.elections.filter(e => e.status === 'open').length;
  const totalVoters = new Set(mem.ballots.map(b => b.voterHash)).size;
  const totalVotes = mem.ballots.length;
  const closingSoon = mem.elections.filter(e => {
    const hoursLeft = (new Date(e.closesAt) - Date.now()) / 3600000;
    return e.status === 'open' && hoursLeft < 72;
  }).length;

  res.json({ activeElections, totalVoters, totalVotes, closingSoon });
});

// ─── GET /api/admin/activity ──────────────────────────────────────────────────
router.get('/activity', authenticate, requireAdmin, (req, res) => {
  if (!isDev) return res.status(501).json({ error: 'DB not configured.' });

  const recent = [...mem.ballots]
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
    .slice(0, 20)
    .map(b => {
      const election = mem.elections.find(e => e.id === b.electionId);
      return {
        voterHash: b.voterHash,
        electionTitle: election?.title || 'Unknown',
        submittedAt: b.submittedAt,
        status: 'voted'
      };
    });

  res.json({ activity: recent });
});

// ─── POST /api/admin/elections ────────────────────────────────────────────────
// Create a new election
router.post('/elections', authenticate, requireAdmin, (req, res) => {
  const { title, description, closesAt, candidates } = req.body;

  if (!title || !closesAt || !candidates || candidates.length < 2) {
    return res.status(400).json({ error: 'Title, closesAt, and at least 2 candidates required.' });
  }

  if (!isDev) {
    // TODO (your friend): INSERT INTO elections + INSERT INTO election_candidates
    return res.status(501).json({ error: 'DB not configured.' });
  }

  const id = mem.elections.length + 1;
  const election = {
    id, title, description, status: 'open',
    closesAt: new Date(closesAt).toISOString(),
    candidates: candidates.map((c, i) => ({ id: Date.now() + i, name: c.name, year: c.year, degree: c.degree }))
  };
  mem.elections.push(election);

  res.status(201).json({ message: 'Election created.', election });
});

// ─── PATCH /api/admin/elections/:id ──────────────────────────────────────────
// Update or close an election
router.patch('/elections/:id', authenticate, requireAdmin, (req, res) => {
  const electionId = parseInt(req.params.id);
  const { status, title, description, closesAt } = req.body;

  if (!isDev) return res.status(501).json({ error: 'DB not configured.' });

  const election = mem.elections.find(e => e.id === electionId);
  if (!election) return res.status(404).json({ error: 'Election not found.' });

  if (status) election.status = status;
  if (title) election.title = title;
  if (description) election.description = description;
  if (closesAt) election.closesAt = new Date(closesAt).toISOString();

  res.json({ message: 'Election updated.', election });
});

module.exports = router;

// routes/admin.js
// Admin-only routes: stats, voter activity, create/update elections

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [activeRes, votersRes, votesRes, closingRes] = await Promise.all([
      query(`SELECT COUNT(*)::int AS count FROM elections WHERE status = 'open' AND NOW() BETWEEN starts_at AND ends_at`),
      query(`SELECT COUNT(DISTINCT voter_hash)::int AS count FROM ballot_submissions WHERE is_current = TRUE`),
      query(`SELECT COUNT(*)::int AS count FROM ballot_submissions WHERE is_current = TRUE`),
      query(`SELECT COUNT(*)::int AS count FROM elections WHERE status = 'open' AND ends_at < NOW() + INTERVAL '3 days'`)
    ]);

    res.json({
      activeElections: activeRes[0].count,
      totalVoters: votersRes[0].count,
      totalVotes: votesRes[0].count,
      closingSoon: closingRes[0].count
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── GET /api/admin/activity ──────────────────────────────────────────────────
router.get('/activity', authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await query(
      `SELECT bs.voter_hash AS "voterHash",
              e.election_name AS "electionTitle",
              bs.submitted_at AS "submittedAt",
              bs.submission_number AS "submissionNumber",
              CASE WHEN bs.submission_number > 1 THEN 'updated' ELSE 'voted' END AS status
       FROM ballot_submissions bs
       JOIN elections e ON e.election_id = bs.election_id
       WHERE bs.is_current = TRUE
       ORDER BY bs.submitted_at DESC
       LIMIT 20`
    );

    res.json({ activity: rows });
  } catch (err) {
    console.error('[admin/activity]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── POST /api/admin/elections ────────────────────────────────────────────────
router.post('/elections', authenticate, requireAdmin, async (req, res) => {
  try {
    const { title, description, clubId, startsAt, closesAt, candidates } = req.body;

    if (!title || !startsAt || !closesAt || !candidates || candidates.length < 2) {
      return res.status(400).json({ error: 'Title, startsAt, closesAt, and at least 2 candidates required.' });
    }

    // Use club_id = 1 as default if not provided
    const effectiveClubId = clubId || 1;

    const electionRows = await query(
      `INSERT INTO elections (club_id, election_name, description, election_type, status, starts_at, ends_at)
       VALUES ($1, $2, $3, 'IRV', 'open', $4, $5)
       RETURNING election_id`,
      [effectiveClubId, title, description || '', startsAt, closesAt]
    );
    const electionId = electionRows[0].election_id;

    for (let i = 0; i < candidates.length; i++) {
      await query(
        `INSERT INTO election_candidates (election_id, display_name, bio, ballot_order)
         VALUES ($1, $2, $3, $4)`,
        [electionId, candidates[i].name, candidates[i].bio || '', i + 1]
      );
    }

    res.status(201).json({ message: 'Election created.', electionId });
  } catch (err) {
    console.error('[admin/create-election]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── PATCH /api/admin/elections/:id ──────────────────────────────────────────
router.patch('/elections/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const electionId = parseInt(req.params.id, 10);
    if (isNaN(electionId)) return res.status(400).json({ error: 'Invalid election ID.' });

    const { status, title, description, ends_at } = req.body;

    const existing = await query('SELECT election_id FROM elections WHERE election_id = $1', [electionId]);
    if (existing.length === 0) return res.status(404).json({ error: 'Election not found.' });

    const sets = [];
    const params = [];
    let paramIdx = 1;

    if (status) {
      sets.push(`status = $${paramIdx++}`);
      params.push(status);
    }
    if (title) {
      sets.push(`election_name = $${paramIdx++}`);
      params.push(title);
    }
    if (description !== undefined) {
      sets.push(`description = $${paramIdx++}`);
      params.push(description);
    }
    if (ends_at) {
      sets.push(`ends_at = $${paramIdx++}`);
      params.push(ends_at);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    params.push(electionId);

    await query(
      `UPDATE elections SET ${sets.join(', ')} WHERE election_id = $${paramIdx}`,
      params
    );

    res.json({ message: 'Election updated.' });
  } catch (err) {
    console.error('[admin/update-election]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;

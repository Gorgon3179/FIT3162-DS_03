// routes/elections.js
// Voting API: election listing, ballot submission, vote replacement, results

const express = require('express');
const router = express.Router();
const { query, getClient } = require('../db');
const { authenticate } = require('../middleware/auth');
const { runIRV } = require('../utils');

// ─── GET /api/elections ───────────────────────────────────────────────────────
// Returns all open elections within their voting window
router.get('/', authenticate, async (req, res) => {
  try {
    const { voterHash } = req.user;

    const elections = await query(`
      SELECT
        e.election_id AS id,
        e.election_name AS title,
        e.description,
        e.status,
        e.starts_at,
        e.ends_at AS "closesAt",
        e.election_type,
        (SELECT COUNT(*) FROM election_candidates ec WHERE ec.election_id = e.election_id)::int AS "candidateCount",
        EXISTS(
          SELECT 1 FROM ballot_submissions bs
          WHERE bs.election_id = e.election_id
            AND bs.voter_hash = $1
            AND bs.is_current = TRUE
        ) AS "hasVoted",
        (SELECT bs.submission_number FROM ballot_submissions bs
         WHERE bs.election_id = e.election_id
           AND bs.voter_hash = $1
           AND bs.is_current = TRUE)::int AS "submissionNumber"
      FROM elections e
      WHERE e.status = 'open'
        AND NOW() BETWEEN e.starts_at AND e.ends_at
      ORDER BY e.ends_at
    `, [voterHash]);

    res.json({ elections });
  } catch (err) {
    console.error('[elections/list]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── GET /api/elections/:id ───────────────────────────────────────────────────
// Returns single election with candidates (randomized order)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const electionId = parseInt(req.params.id, 10);
    const { voterHash } = req.user;
    if (isNaN(electionId)) return res.status(400).json({ error: 'Invalid election ID.' });

    const electionRows = await query(
      'SELECT election_id, election_name, description, status, election_type, starts_at, ends_at FROM elections WHERE election_id = $1',
      [electionId]
    );
    if (electionRows.length === 0) return res.status(404).json({ error: 'Election not found.' });
    const e = electionRows[0];

    const candidates = await query(
      'SELECT candidate_id AS id, display_name AS name, bio FROM election_candidates WHERE election_id = $1 AND is_active = TRUE ORDER BY RANDOM()',
      [electionId]
    );

    const votedRows = await query(
      'SELECT submission_number FROM ballot_submissions WHERE election_id = $1 AND voter_hash = $2 AND is_current = TRUE',
      [electionId, voterHash]
    );

    res.json({
      id: e.election_id,
      title: e.election_name,
      description: e.description,
      status: e.status,
      electionType: e.election_type,
      startsAt: e.starts_at,
      closesAt: e.ends_at,
      candidates,
      hasVoted: votedRows.length > 0,
      submissionNumber: votedRows.length > 0 ? votedRows[0].submission_number : 0
    });
  } catch (err) {
    console.error('[elections/detail]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── POST /api/elections/:id/vote ─────────────────────────────────────────────
// Submit or replace a ranked-choice ballot (vote replacement supported)
router.post('/:id/vote', authenticate, async (req, res) => {
  try {
    const electionId = parseInt(req.params.id, 10);
    const { voterHash } = req.user;
    const { rankings } = req.body;

    if (isNaN(electionId)) return res.status(400).json({ error: 'Invalid election ID.' });
    if (!rankings || !Array.isArray(rankings) || rankings.length === 0) {
      return res.status(400).json({ error: 'Rankings are required.' });
    }

    const electionRows = await query(
      `SELECT election_id, status FROM elections
       WHERE election_id = $1 AND status = 'open' AND NOW() BETWEEN starts_at AND ends_at`,
      [electionId]
    );
    if (electionRows.length === 0) {
      return res.status(400).json({ error: 'Election not found or is closed.' });
    }

    const candidateRows = await query(
      'SELECT candidate_id FROM election_candidates WHERE election_id = $1 AND is_active = TRUE',
      [electionId]
    );
    const validIds = new Set(candidateRows.map(c => Number(c.candidate_id)));

    for (const r of rankings) {
      if (!validIds.has(r.candidate_id)) {
        return res.status(400).json({ error: `Invalid candidate ID: ${r.candidate_id}` });
      }
      if (typeof r.rank_position !== 'number' || r.rank_position < 1 || r.rank_position > validIds.size) {
        return res.status(400).json({ error: 'Invalid rank value.' });
      }
    }
    const rankValues = rankings.map(r => r.rank_position);
    if (new Set(rankValues).size !== rankValues.length) {
      return res.status(400).json({ error: 'Each rank must be assigned to only one candidate.' });
    }

    const dbClient = getClient();
    if (!dbClient) {
      return res.status(500).json({ error: 'Database not connected.' });
    }
    await dbClient.query('BEGIN');

    const currentBallot = await query(
      `SELECT ballot_submission_id, submission_number
       FROM ballot_submissions
       WHERE election_id = $1 AND voter_hash = $2 AND is_current = TRUE`,
      [electionId, voterHash]
    );

    let oldBallotId = null;
    let submissionNumber = 1;

    if (currentBallot.length > 0) {
      oldBallotId = currentBallot[0].ballot_submission_id;
      submissionNumber = currentBallot[0].submission_number + 1;

      await query(
        `UPDATE ballot_submissions
         SET is_current = FALSE, replaced_at = NOW()
         WHERE ballot_submission_id = $1`,
        [oldBallotId]
      );
    }

    const newBallot = await query(
      `INSERT INTO ballot_submissions
        (election_id, voter_hash, submission_number, submitted_at, is_current, replaced_ballot_submission_id)
       VALUES ($1, $2, $3, NOW(), TRUE, $4)
       RETURNING ballot_submission_id`,
      [electionId, voterHash, submissionNumber, oldBallotId]
    );
    const newBallotId = newBallot[0].ballot_submission_id;

    for (const r of rankings) {
      await query(
        `INSERT INTO ballot_rankings (ballot_submission_id, candidate_id, rank_position)
         VALUES ($1, $2, $3)`,
        [newBallotId, r.candidate_id, r.rank_position]
      );
    }

    await query(
      `INSERT INTO ballot_vote (ballot_submission_id, voter_hash, election_id, trait_option_id)
       SELECT $1, voter_hash, $2, trait_option_id
       FROM voter_trait_options
       WHERE voter_hash = $3 AND is_current = TRUE`,
      [newBallotId, electionId, voterHash]
    );

    await dbClient.query('COMMIT');

    res.json({ message: 'Ballot submitted successfully.', submissionNumber });
  } catch (err) {
    try {
      const dbClient = getClient();
      if (dbClient) await dbClient.query('ROLLBACK');
    } catch (_) {}
    console.error('[elections/vote]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── GET /api/elections/:id/results ──────────────────────────────────────────
// IRV results + trait breakdown (only if election ended)
router.get('/:id/results', authenticate, async (req, res) => {
  try {
    const electionId = parseInt(req.params.id, 10);
    if (isNaN(electionId)) return res.status(400).json({ error: 'Invalid election ID.' });

    // Fetch election
    const electionRows = await query(
      'SELECT election_id, election_name, description, status, ends_at FROM elections WHERE election_id = $1',
      [electionId]
    );
    if (electionRows.length === 0) return res.status(404).json({ error: 'Election not found.' });

    const election = electionRows[0];

    // Check if election has ended
    if (new Date() < new Date(election.ends_at)) {
      return res.json({
        resultsAvailable: false,
        message: 'Results will be available after the election ends.',
        endsAt: election.ends_at
      });
    }

    // Fetch ballots + rankings (current only)
    const ballotRows = await query(
      `SELECT bs.ballot_submission_id, bs.voter_hash,
              br.candidate_id, br.rank_position
       FROM ballot_submissions bs
       JOIN ballot_rankings br ON br.ballot_submission_id = bs.ballot_submission_id
       WHERE bs.election_id = $1 AND bs.is_current = TRUE
       ORDER BY bs.ballot_submission_id, br.rank_position`,
      [electionId]
    );

    // Fetch candidates
    const candidates = await query(
      'SELECT candidate_id AS id, display_name AS name, bio FROM election_candidates WHERE election_id = $1',
      [electionId]
    );

    // Group ballots by voter
    const ballotsByVoter = {};
    for (const row of ballotRows) {
      if (!ballotsByVoter[row.voter_hash]) {
        ballotsByVoter[row.voter_hash] = [];
      }
      ballotsByVoter[row.voter_hash].push({
        candidateId: row.candidate_id,
        rank: row.rank_position
      });
    }

    const allBallots = Object.values(ballotsByVoter).map(rankings => ({ rankings }));
    const totalVotes = allBallots.length;

    // Run IRV
    let irvResult = null;
    let firstPref = null;
    let traitBreakdown = null;

    if (totalVotes > 0) {
      irvResult = runIRV(allBallots, candidates);

      // First preference breakdown
      firstPref = await query(
        `SELECT ec.candidate_id, ec.display_name, COUNT(*)::int AS votes
         FROM ballot_submissions bs
         JOIN ballot_rankings br ON br.ballot_submission_id = bs.ballot_submission_id AND br.rank_position = 1
         JOIN election_candidates ec ON ec.candidate_id = br.candidate_id
         WHERE bs.election_id = $1 AND bs.is_current = TRUE
         GROUP BY ec.candidate_id, ec.display_name
         ORDER BY votes DESC`,
        [electionId]
      );

      // Trait breakdown
      const breakdownRows = await query(
        `SELECT t.trait_name, tro.option_value, ec.display_name, COUNT(*)::int AS vote_count
         FROM ballot_submissions bs
         JOIN ballot_rankings br ON br.ballot_submission_id = bs.ballot_submission_id AND br.rank_position = 1
         JOIN election_candidates ec ON ec.candidate_id = br.candidate_id
         JOIN ballot_vote bv ON bv.ballot_submission_id = bs.ballot_submission_id
         JOIN trait_options tro ON tro.trait_option_id = bv.trait_option_id
         JOIN traits t ON t.trait_id = tro.trait_id
         WHERE bs.election_id = $1 AND bs.is_current = TRUE
         GROUP BY t.trait_name, tro.option_value, ec.display_name
         ORDER BY t.trait_name, tro.option_value`,
        [electionId]
      );

      // Group breakdown by trait
      traitBreakdown = {};
      for (const row of breakdownRows) {
        if (!traitBreakdown[row.trait_name]) {
          traitBreakdown[row.trait_name] = {};
        }
        const optionKey = row.option_value;
        if (!traitBreakdown[row.trait_name][optionKey]) {
          traitBreakdown[row.trait_name][optionKey] = {};
        }
        traitBreakdown[row.trait_name][optionKey][row.display_name] = row.vote_count;
      }
    }

    res.json({
      electionId,
      electionTitle: election.election_name,
      totalVotes,
      winner: irvResult?.winner || null,
      rounds: irvResult?.rounds || [],
      finalTally: firstPref || [],
      traitBreakdown: traitBreakdown || {}
    });
  } catch (err) {
    console.error('[elections/results]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;

// routes/elections.js
// R3: One vote per user per election (enforced via voterHash uniqueness)
// R6: Results broken down by voter traits
// R9: Front-end voting API (IRV ranked-choice ballot submission)

const express = require('express');
const router = express.Router();
const { mem, isDev } = require('../db');
const { authenticate } = require('../middleware/auth');
const { runIRV } = require('../utils');

// ─── GET /api/elections ───────────────────────────────────────────────────────
// Returns all open elections (voter must be logged in)
router.get('/', authenticate, (req, res) => {
  if (!isDev) {
    // TODO (your friend): SELECT * FROM elections WHERE status = 'open'
    return res.status(501).json({ error: 'DB not configured.' });
  }

  const { voterHash } = req.user;

  const elections = mem.elections.map(e => {
    const hasVoted = mem.ballots.some(
      b => b.electionId === e.id && b.voterHash === voterHash
    );
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      status: e.status,
      closesAt: e.closesAt,
      candidateCount: e.candidates.length,
      hasVoted
    };
  });

  res.json({ elections });
});

// ─── GET /api/elections/:id ───────────────────────────────────────────────────
// Returns a single election with its candidates (randomised order per R13)
router.get('/:id', authenticate, (req, res) => {
  const electionId = parseInt(req.params.id);

  if (!isDev) {
    // TODO (your friend): SELECT elections.*, candidates.* FROM elections JOIN election_candidates ...
    return res.status(501).json({ error: 'DB not configured.' });
  }

  const election = mem.elections.find(e => e.id === electionId);
  if (!election) return res.status(404).json({ error: 'Election not found.' });

  const hasVoted = mem.ballots.some(
    b => b.electionId === electionId && b.voterHash === req.user.voterHash
  );

  // R13: Randomise candidate order for each voter
  const candidates = [...election.candidates].sort(() => Math.random() - 0.5);

  res.json({
    id: election.id,
    title: election.title,
    description: election.description,
    status: election.status,
    closesAt: election.closesAt,
    candidates,
    hasVoted
  });
});

// ─── POST /api/elections/:id/vote ─────────────────────────────────────────────
// R9: Submit a ranked-choice ballot
// R3: Prevents duplicate votes using voterHash
router.post('/:id/vote', authenticate, (req, res) => {
  const electionId = parseInt(req.params.id);
  const { voterHash } = req.user;

  if (!isDev) {
    // TODO (your friend):
    // 1. Check ballot_submissions WHERE election_id=$1 AND voter_hash=$2
    // 2. If exists → 409
    // 3. INSERT ballot_submissions, then INSERT ballot_rankings
    return res.status(501).json({ error: 'DB not configured.' });
  }

  const election = mem.elections.find(e => e.id === electionId);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  if (election.status !== 'open') return res.status(400).json({ error: 'This election is closed.' });

  // R3: Check for existing vote
  const alreadyVoted = mem.ballots.some(
    b => b.electionId === electionId && b.voterHash === voterHash
  );
  if (alreadyVoted) {
    return res.status(409).json({ error: 'You have already voted in this election.' });
  }

  // Validate rankings
  const { rankings } = req.body; // [{ candidateId, rank }]
  if (!rankings || !Array.isArray(rankings) || rankings.length === 0) {
    return res.status(400).json({ error: 'Rankings are required.' });
  }

  const validCandidateIds = election.candidates.map(c => c.id);
  for (const r of rankings) {
    if (!validCandidateIds.includes(r.candidateId)) {
      return res.status(400).json({ error: `Invalid candidate ID: ${r.candidateId}` });
    }
    if (typeof r.rank !== 'number' || r.rank < 1 || r.rank > election.candidates.length) {
      return res.status(400).json({ error: 'Invalid rank value.' });
    }
  }

  // Ensure no duplicate ranks
  const ranks = rankings.map(r => r.rank);
  if (new Set(ranks).size !== ranks.length) {
    return res.status(400).json({ error: 'Each rank must be assigned to only one candidate.' });
  }

  // Store the ballot (voter identity is the hash only — anonymous)
  mem.ballots.push({
    id: mem.ballots.length + 1,
    electionId,
    voterHash,   // R2: only the hash is stored, not the real ID
    rankings,
    submittedAt: new Date().toISOString()
  });

  res.json({ message: 'Ballot submitted successfully.' });
});

// ─── GET /api/elections/:id/results ──────────────────────────────────────────
// R6: Returns IRV results + breakdown by voter traits
router.get('/:id/results', authenticate, (req, res) => {
  const electionId = parseInt(req.params.id);

  if (!isDev) {
    // TODO (your friend): complex JOIN across ballot_submissions, ballot_rankings, voter_trait_responses
    return res.status(501).json({ error: 'DB not configured.' });
  }

  const election = mem.elections.find(e => e.id === electionId);
  if (!election) return res.status(404).json({ error: 'Election not found.' });

  const ballots = mem.ballots.filter(b => b.electionId === electionId);
  const totalVotes = ballots.length;

  // Run IRV tally
  const irvResult = runIRV(ballots, election.candidates);

  // R6: Trait breakdown - match voter hashes to stored traits
  const traitBreakdown = {};
  const traitKeys = ['yearOfStudy', 'faculty', 'campus', 'countryOfOrigin', 'clubsJoined'];

  for (const trait of traitKeys) {
    traitBreakdown[trait] = {};
    for (const ballot of ballots) {
      const voterTraits = mem.traits.find(t => t.voterHash === ballot.voterHash);
      const traitValue = voterTraits ? voterTraits[trait] : 'Unknown';
      const firstPref = ballot.rankings.find(r => r.rank === 1);
      if (!firstPref) continue;
      const candidateName = election.candidates.find(c => c.id === firstPref.candidateId)?.name || 'Unknown';

      if (!traitBreakdown[trait][traitValue]) {
        traitBreakdown[trait][traitValue] = {};
      }
      traitBreakdown[trait][traitValue][candidateName] =
        (traitBreakdown[trait][traitValue][candidateName] || 0) + 1;
    }
  }

  res.json({
    electionId,
    electionTitle: election.title,
    totalVotes,
    winner: irvResult.winner,
    rounds: irvResult.rounds,
    finalTally: irvResult.finalTally,
    traitBreakdown
  });
});

module.exports = router;

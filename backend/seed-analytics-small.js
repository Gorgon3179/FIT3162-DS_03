// backend/seed-analytics-small.js
// Seed 100-200 fake voters into brand-new elections only (does NOT touch existing elections 1-5)
// Run: node seed-analytics-small.js   (from backend/)

require('dotenv').config({ quiet: true, path: __dirname + '/.env' });
const crypto = require('crypto');
const { connect, query, getClient } = require('./db');

function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pickRandom(arr) { return arr[randomInt(0, arr.length - 1)]; }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = randomInt(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function hashVoterId(email) { return crypto.createHash('sha256').update(email).digest('hex'); }
function daysAgo(n) { return new Date(Date.now() - n * 86400000); }
function iso(d) { return d.toISOString(); }

async function batchInsert(table, columns, rows, batchSize = 2000) {
  if (!rows.length) return;
  const client = getClient();
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const values = [];
    const placeholders = [];
    let idx = 1;
    for (const row of chunk) {
      const rowPlaceholders = row.map(() => `$${idx++}`);
      placeholders.push(`(${rowPlaceholders.join(',')})`);
      values.push(...row);
    }
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`;
    await client.query(sql, values);
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────
const VOTER_COUNT = 150;           // 100-200 voters
const REVOTE_RATE = 0.12;          // 12% revote
const TRAIT_UPDATE_RATE = 0.06;    // 6% update traits
const VOTE_PARTICIPATION = {       // % of voters who vote in each election
  e1: 0.70,
  e2: 0.50,
  e3: 0.40,
};

(async () => {
  try {
    await connect();
    const client = getClient();

    console.log('📊 Seeding small analytics data (~150 voters into new elections)…');

    // ── 1. Load trait options ─────────────────────────────────────────────────
    const traitOptionRows = await query('SELECT trait_option_id, trait_id FROM trait_options');
    const optionsByTrait = new Map();
    for (const row of traitOptionRows) {
      if (!optionsByTrait.has(row.trait_id)) optionsByTrait.set(row.trait_id, []);
      optionsByTrait.get(row.trait_id).push(row.trait_option_id);
    }
    const allTraitIds = Array.from(optionsByTrait.keys());
    console.log(`   Loaded ${traitOptionRows.length} trait options across ${allTraitIds.length} traits`);

    // ── 2. Create voters ──────────────────────────────────────────────────────
    console.log(`   Creating ${VOTER_COUNT} voters…`);
    const voterHashes = [];
    const voterRows = [];
    const authRows = [];
    for (let i = 0; i < VOTER_COUNT; i++) {
      const email = `seed${i}@student.monash.edu`;
      const salt = crypto.randomBytes(16).toString('hex');
      const voterHash = hashVoterId(email + salt);
      voterHashes.push(voterHash);
      voterRows.push([voterHash, salt]);
      authRows.push([email, '', voterHash, false]);
    }
    await batchInsert('voters', ['voter_hash', 'salt'], voterRows);
    await batchInsert('auth_users', ['email', 'password_hash', 'voter_hash', 'is_admin'], authRows);
    console.log('   ✓ Voters created');

    // ── 3. Assign traits (one option per trait per voter) ─────────────────────
    console.log('   Assigning traits…');
    const traitRows = [];
    const voterTraitOptions = new Map(); // voterHash -> Set<trait_option_id>
    for (const vh of voterHashes) {
      voterTraitOptions.set(vh, new Set());
      for (const traitId of allTraitIds) {
        const optId = pickRandom(optionsByTrait.get(traitId));
        const createdAt = iso(daysAgo(randomInt(1, 60)));
        traitRows.push([vh, optId, true, createdAt, createdAt]);
        voterTraitOptions.get(vh).add(optId);
      }
    }
    await batchInsert('voter_trait_options',
      ['voter_hash', 'trait_option_id', 'is_current', 'created_at', 'last_updated_at'], traitRows, 2000);
    console.log('   ✓ Traits assigned');

    // ── 4. Create 3 brand-new elections (Demo A, Demo B, Demo C private) ────────
    console.log('   Creating new demo elections…');
    const electionNames = [
      ['Demo Election A (Public)', 'Public demo for analytics', false],
      ['Demo Election B (Public)',  'Another public demo', false],
      ['Demo Election C (Private)', 'Private demo (whitelist)', true],
    ];
    const elections = [];
    for (const [name, desc, isPrivate] of electionNames) {
      const res = await client.query(
        `INSERT INTO elections (club_id, election_name, description, election_type, status, is_private, starts_at, ends_at)
         VALUES (1, $1, $2, 'IRV', 'open', $3, $4, $5)
         RETURNING election_id`,
        [name, desc, isPrivate, iso(daysAgo(14)), iso(daysAgo(-7))]
      );
      elections.push({ id: res.rows[0].election_id, isPrivate });
    }
    const [e1, e2, e3] = elections;
    console.log(`   ✓ Elections: A=${e1.id}, B=${e2.id}, C=${e3.id}`);

    // ── 5. Create candidates ──────────────────────────────────────────────────
    const candidateNames = {
      [e1.id]: ['Alice Johnson', 'Bob Smith', 'Charlie Davis', 'Dana Lee'],
      [e2.id]: ['Evan Wright', 'Fiona Chen', 'George Kim'],
      [e3.id]: ['Hannah Park', 'Ian Patel', 'Jack Brown'],
    };
    const candidatesByElection = {};
    for (const [eid, names] of Object.entries(candidateNames)) {
      const ids = [];
      for (let i = 0; i < names.length; i++) {
        const res = await client.query(
          `INSERT INTO election_candidates (election_id, display_name, bio, ballot_order)
           VALUES ($1, $2, $3, $4)
           RETURNING candidate_id`,
          [eid, names[i], `Bio for ${names[i]}`, i + 1]
        );
        ids.push(res.rows[0].candidate_id);
      }
      candidatesByElection[eid] = ids;
    }
    console.log('   ✓ Candidates created');

    // ── 6. Whitelist voters for private election ────────────────────────────────
    const privateVoterCount = Math.floor(VOTER_COUNT * VOTE_PARTICIPATION.e3);
    const privateVoters = shuffle([...voterHashes]).slice(0, privateVoterCount);
    const whitelistRows = privateVoters.map(vh => [vh, e3.id]);
    await batchInsert('election_whitelist', ['voter_hash', 'election_id'], whitelistRows);
    console.log(`   ✓ ${privateVoterCount} voters whitelisted for private election`);

    // ── 7. Submit ballots (batch everything) ────────────────────────────────────
    console.log('   Submitting ballots…');

    function makeBallotRows(voterHashes, electionId, participationRate, dayRange) {
      const bsRows = [];     // [election_id, voter_hash, submission_number, submitted_at, is_current]
      const rankRows = [];   // [ballot_submission_id, candidate_id, rank_position]
      const voteRows = [];   // [voter_hash, trait_option_id, election_id, ballot_submission_id, created_at]

      let bsId = -1; // temporary placeholder, we'll fetch actual IDs after insert
      // Actually we can't pre-assign IDs. We'll use a sequential temporary ID and replace after bulk insert.

      // Better: collect all data grouped, insert ballot_submissions, get IDs back via RETURNING
      // But doing RETURNING for 1000+ rows is heavy. Let's insert per-voter in a loop but batch rankings/votes.
      // With only 150 voters and ~3 elections, loop is fast enough.

      return { eligible: voterHashes.filter(() => Math.random() < participationRate) };
    }

    // Helper to submit a single ballot and return data
    async function submit(electionId, voterHash, subNum, dayOffset) {
      const submittedAt = iso(daysAgo(dayOffset));
      const cands = candidatesByElection[electionId];
      const rankCount = Math.random() < 0.85 ? cands.length : randomInt(1, cands.length);
      const ranking = shuffle([...cands]).slice(0, rankCount);

      // Mark previous non-current if revote
      if (subNum > 1) {
        await client.query(
          `UPDATE ballot_submissions SET is_current = FALSE WHERE election_id = $1 AND voter_hash = $2 AND is_current = TRUE`,
          [electionId, voterHash]
        );
      }

      const bsRes = await client.query(
        `INSERT INTO ballot_submissions (election_id, voter_hash, submission_number, submitted_at, is_current)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING ballot_submission_id`,
        [electionId, voterHash, subNum, submittedAt, true]
      );
      const bsId = bsRes.rows[0].ballot_submission_id;

      const newRankings = ranking.map((c, i) => [bsId, c, i + 1]);
      const newVotes = Array.from(voterTraitOptions.get(voterHash) || []).map(toId => [voterHash, toId, electionId, bsId, submittedAt]);

      return { bsId, rankings: newRankings, votes: newVotes };
    }

    let allRankings = [];
    let allVotes = [];

    // Election A
    let count = 0;
    for (const vh of voterHashes) {
      if (Math.random() < VOTE_PARTICIPATION.e1) {
        const b = await submit(e1.id, vh, 1, randomInt(0, 13));
        allRankings.push(...b.rankings);
        allVotes.push(...b.votes);
        count++;
      }
    }
    console.log(`   ✓ ${count} ballots for Demo A`);

    // Election B
    count = 0;
    for (const vh of voterHashes) {
      if (Math.random() < VOTE_PARTICIPATION.e2) {
        const b = await submit(e2.id, vh, 1, randomInt(0, 10));
        allRankings.push(...b.rankings);
        allVotes.push(...b.votes);
        count++;
      }
    }
    console.log(`   ✓ ${count} ballots for Demo B`);

    // Election C (private, whitelisted only)
    count = 0;
    for (const vh of privateVoters) {
      if (Math.random() < 0.75) {
        const b = await submit(e3.id, vh, 1, randomInt(0, 11));
        allRankings.push(...b.rankings);
        allVotes.push(...b.votes);
        count++;
      }
    }
    console.log(`   ✓ ${count} ballots for Demo C (private)`);

    // Bulk insert rankings & votes
    await batchInsert('ballot_rankings', ['ballot_submission_id', 'candidate_id', 'rank_position'], allRankings, 2000);
    await batchInsert('ballot_vote', ['voter_hash', 'trait_option_id', 'election_id', 'ballot_submission_id', 'created_at'], allVotes, 2000);
    console.log(`   ✓ ${allRankings.length} rankings & ${allVotes.length} ballot_votes inserted`);

    // ── 8. Create revotes (~12% of voters) ────────────────────────────────────
    console.log('   Creating revotes…');
    let revoteCount = 0;
    const revoters = shuffle([...voterHashes]).slice(0, Math.floor(VOTER_COUNT * REVOTE_RATE));
    for (const vh of revoters) {
      // Pick one election they likely voted in
      const possible = [];
      if (Math.random() < VOTE_PARTICIPATION.e1) possible.push(e1.id);
      if (Math.random() < VOTE_PARTICIPATION.e2) possible.push(e2.id);
      if (privateVoters.includes(vh) && Math.random() < 0.75) possible.push(e3.id);
      if (!possible.length) continue;
      const eid = pickRandom(possible);
      const b = await submit(eid, vh, 2, randomInt(0, 3));
      allRankings.push(...b.rankings);
      allVotes.push(...b.votes);
      revoteCount++;
    }
    console.log(`   ✓ ${revoteCount} revotes created`);

    // Insert revote rankings & votes
    await batchInsert('ballot_rankings', ['ballot_submission_id', 'candidate_id', 'rank_position'], allRankings, 2000);
    await batchInsert('ballot_vote', ['voter_hash', 'trait_option_id', 'election_id', 'ballot_submission_id', 'created_at'], allVotes, 2000);

    // ── 9. Trait updates (~6% of voters) ──────────────────────────────────────
    console.log('   Creating trait updates…');
    let traitUpdateCount = 0;
    const traitUpdaters = shuffle([...voterHashes]).slice(0, Math.floor(VOTER_COUNT * TRAIT_UPDATE_RATE));
    for (const vh of traitUpdaters) {
      const traitsToUpdate = shuffle([...allTraitIds]).slice(0, randomInt(1, 3));
      for (const traitId of traitsToUpdate) {
        const newOpt = pickRandom(optionsByTrait.get(traitId));
        const updatedAt = iso(daysAgo(randomInt(0, 5)));
        await client.query(
          `UPDATE voter_trait_options SET is_current = FALSE, last_updated_at = $1
           WHERE voter_hash = $2 AND trait_option_id IN (
             SELECT trait_option_id FROM trait_options WHERE trait_id = $3
           ) AND is_current = TRUE`,
          [updatedAt, vh, traitId]
        );
        await client.query(
          `INSERT INTO voter_trait_options (voter_hash, trait_option_id, is_current, created_at, last_updated_at)
           VALUES ($1,$2,TRUE,$3,$3)
           ON CONFLICT (voter_hash, trait_option_id) WHERE is_current = TRUE DO NOTHING`,
          [vh, newOpt, updatedAt]
        );
      }
      traitUpdateCount++;
    }
    console.log(`   ✓ ${traitUpdateCount} voters updated traits`);

    // ── Summary ───────────────────────────────────────────────────────────────
    const stats = await query(`
      SELECT
        (SELECT COUNT(*)::int FROM voters) AS total_voters,
        (SELECT COUNT(*)::int FROM ballot_submissions WHERE is_current = TRUE) AS total_ballots,
        (SELECT COUNT(*)::int FROM ballot_submissions WHERE submission_number > 1) AS total_revotes,
        (SELECT COUNT(DISTINCT voter_hash)::int FROM voter_trait_options WHERE is_current = TRUE) AS voters_with_traits
    `);
    console.log('\n📈 Seed Summary:');
    console.log(`   Total voters:          ${stats[0].total_voters}`);
    console.log(`   Total current ballots: ${stats[0].total_ballots}`);
    console.log(`   Total revotes:         ${stats[0].total_revotes}`);
    console.log(`   Voters with traits:    ${stats[0].voters_with_traits}`);
    console.log('\n✅ Seed complete! Refresh http://localhost:3000/analytics.html');

    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  }
})();

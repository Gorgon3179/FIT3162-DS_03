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

// ─── GET /api/admin/elections ────────────────────────────────────────────────
// List all elections (all statuses) for admin management
router.get('/elections', authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await query(
      `SELECT election_id AS id, election_name AS title, description, status,
              starts_at AS "startsAt", ends_at AS "closesAt", election_type AS "electionType"
       FROM elections
       ORDER BY ends_at DESC`
    );
    res.json({ elections: rows });
  } catch (err) {
    console.error('[admin/list-elections]', err);
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


// ─── GET /api/admin/analytics/trait-distribution ────────────────────────────
// Admin analytics: current voter trait distribution grouped by trait category.
router.get('/analytics/trait-distribution', authenticate, requireAdmin, async (req, res) => {
  try {
    const voterRows = await query(`
      SELECT COUNT(DISTINCT voter_hash)::int AS count
      FROM voter_trait_options
      WHERE is_current = TRUE
    `);

    const rows = await query(`
      SELECT
        tc.trait_category_id AS category_id,
        tc.category_name,
        COALESCE(tc.display_order, 9999) AS category_order,
        t.trait_id,
        t.trait_name,
        t.is_required,
        COALESCE(t.display_order, 9999) AS trait_order,
        tro.trait_option_id,
        tro.option_value,
        COALESCE(tro.display_order, 9999) AS option_order,
        COUNT(DISTINCT vto.voter_hash)::int AS voter_count
      FROM trait_categories tc
      JOIN traits t ON t.trait_category_id = tc.trait_category_id
      JOIN trait_options tro ON tro.trait_id = t.trait_id
      LEFT JOIN voter_trait_options vto
        ON vto.trait_option_id = tro.trait_option_id
       AND vto.is_current = TRUE
      GROUP BY
        tc.trait_category_id, tc.category_name, tc.display_order,
        t.trait_id, t.trait_name, t.is_required, t.display_order,
        tro.trait_option_id, tro.option_value, tro.display_order
      ORDER BY category_order, tc.category_name, trait_order, t.trait_name, option_order, tro.option_value
    `);

    const categoriesMap = new Map();
    for (const row of rows) {
      if (!categoriesMap.has(row.category_id)) {
        categoriesMap.set(row.category_id, {
          id: row.category_id,
          name: row.category_name,
          traits: []
        });
      }
      const category = categoriesMap.get(row.category_id);
      let trait = category.traits.find(t => t.id === row.trait_id);
      if (!trait) {
        trait = {
          id: row.trait_id,
          name: row.trait_name,
          required: row.is_required,
          options: []
        };
        category.traits.push(trait);
      }
      trait.options.push({
        id: row.trait_option_id,
        value: row.option_value,
        count: row.voter_count
      });
    }

    res.json({
      totalVotersWithTraits: voterRows[0]?.count || 0,
      categories: Array.from(categoriesMap.values())
    });
  } catch (err) {
    console.error('[admin/analytics/trait-distribution]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── GET /api/admin/analytics/vote-changes ──────────────────────────────────
// Admin analytics: vote submissions and re-submissions over time.
router.get('/analytics/vote-changes', authenticate, requireAdmin, async (req, res) => {
  try {
    const totalRows = await query(`
      SELECT
        COUNT(*) FILTER (WHERE is_current = TRUE)::int AS total_new,
        COUNT(*) FILTER (WHERE submission_number > 1)::int AS total_changed,
        COUNT(DISTINCT voter_hash) FILTER (WHERE submission_number > 1)::int AS voters_who_changed
      FROM ballot_submissions
    `);

    const timelineRows = await query(`
      SELECT
        DATE_TRUNC('day', submitted_at)::date AS date,
        COUNT(*) FILTER (WHERE submission_number = 1)::int AS new_votes,
        COUNT(*) FILTER (WHERE submission_number > 1)::int AS changed_votes
      FROM ballot_submissions
      GROUP BY date
      ORDER BY date
    `);

    res.json({
      totals: {
        totalNew: totalRows[0]?.total_new || 0,
        totalChanged: totalRows[0]?.total_changed || 0,
        votersWhoChanged: totalRows[0]?.voters_who_changed || 0
      },
      timeline: timelineRows.map(r => ({
        date: r.date,
        newVotes: r.new_votes,
        changedVotes: r.changed_votes
      }))
    });
  } catch (err) {
    console.error('[admin/analytics/vote-changes]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── GET /api/admin/analytics/trait-changes ─────────────────────────────────
// Admin analytics: initial trait submissions and later trait updates over time.
router.get('/analytics/trait-changes', authenticate, requireAdmin, async (req, res) => {
  try {
    const totalRows = await query(`
      WITH per_voter AS (
        SELECT voter_hash, COUNT(*) AS rows_count
        FROM voter_trait_options
        GROUP BY voter_hash
      ), trait_count AS (
        SELECT GREATEST(COUNT(*), 1)::numeric AS total_traits
        FROM traits
      )
      SELECT
        (SELECT COUNT(DISTINCT voter_hash)::int FROM voter_trait_options WHERE is_current = TRUE) AS voters_with_traits,
        COUNT(*) FILTER (WHERE pv.rows_count > tc.total_traits)::int AS voters_updated_traits
      FROM per_voter pv
      CROSS JOIN trait_count tc
    `);

    const timelineRows = await query(`
      WITH ordered_traits AS (
        SELECT
          voter_hash,
          created_at,
          ROW_NUMBER() OVER (PARTITION BY voter_hash ORDER BY created_at) AS rn
        FROM voter_trait_options
      )
      SELECT
        DATE_TRUNC('day', created_at)::date AS date,
        COUNT(DISTINCT voter_hash) FILTER (WHERE rn = 1)::int AS initial_submissions,
        COUNT(DISTINCT voter_hash) FILTER (WHERE rn > 1)::int AS trait_updates
      FROM ordered_traits
      GROUP BY date
      ORDER BY date
    `);

    res.json({
      totals: {
        votersWithTraits: totalRows[0]?.voters_with_traits || 0,
        votersUpdatedTraits: totalRows[0]?.voters_updated_traits || 0
      },
      timeline: timelineRows.map(r => ({
        date: r.date,
        initialSubmissions: r.initial_submissions,
        traitUpdates: r.trait_updates
      }))
    });
  } catch (err) {
    console.error('[admin/analytics/trait-changes]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── GET /api/admin/analytics/data-science ──────────────────────────────────
// Presentation-ready data science visualisations from live MonashVote data.
router.get('/analytics/data-science', authenticate, requireAdmin, async (req, res) => {
  try {
    const electionId = req.query.electionId ? parseInt(req.query.electionId, 10) : null;
    const electionFilter = electionId ? 'WHERE bs.election_id = $1' : '';
    const params = electionId ? [electionId] : [];

    const electionRows = await query(`
      SELECT
        e.election_id   AS id,
        e.election_name AS title,
        COUNT(DISTINCT bs.voter_hash)::int AS "voterCount"
      FROM elections e
      LEFT JOIN ballot_submissions bs
             ON bs.election_id = e.election_id AND bs.is_current = TRUE
      GROUP BY e.election_id, e.election_name
      ORDER BY e.created_at DESC, e.election_id DESC
    `);

    // Total registered voters = distinct hashes who completed registration (set traits)
    const totalVotersRes = await query(`SELECT COUNT(DISTINCT voter_hash)::int AS total FROM voter_trait_options`);
    const totalVoters = totalVotersRes[0]?.total || 0;

    // Attach totalVoters to every election row so the frontend can compute participation %
    const electionsWithParticipation = electionRows.map(e => ({ ...e, totalVoters }));

    const momentumRows = await query(`
      SELECT
        bs.election_id,
        e.election_name,
        DATE_TRUNC('day', bs.submitted_at)::date AS day,
        ec.display_name AS candidate,
        COUNT(*)::int AS votes
      FROM ballot_submissions bs
      JOIN elections e ON e.election_id = bs.election_id
      JOIN ballot_rankings br
        ON br.ballot_submission_id = bs.ballot_submission_id
       AND br.rank_position = 1
      JOIN election_candidates ec ON ec.candidate_id = br.candidate_id
      ${electionFilter}
      GROUP BY bs.election_id, e.election_name, day, ec.display_name
      ORDER BY day, ec.display_name
    `, params);

    const supportRows = await query(`
      WITH daily AS (
        SELECT
          bs.election_id,
          DATE_TRUNC('day', bs.submitted_at)::date AS day,
          ec.display_name AS candidate,
          COUNT(*)::numeric AS votes
        FROM ballot_submissions bs
        JOIN ballot_rankings br
          ON br.ballot_submission_id = bs.ballot_submission_id
         AND br.rank_position = 1
        JOIN election_candidates ec ON ec.candidate_id = br.candidate_id
        ${electionFilter}
        GROUP BY bs.election_id, day, ec.display_name
      ), totals AS (
        SELECT election_id, day, SUM(votes) AS total_votes
        FROM daily
        GROUP BY election_id, day
      )
      SELECT d.election_id, d.day, d.candidate,
             d.votes::int AS votes,
             ROUND((d.votes / NULLIF(t.total_votes, 0)) * 100, 2)::float AS support_percent
      FROM daily d
      JOIN totals t ON t.election_id = d.election_id AND t.day = d.day
      ORDER BY d.day, d.candidate
    `, params);

    const activityRows = await query(`
      WITH vote_activity AS (
        SELECT
          DATE_TRUNC('day', submitted_at)::date AS day,
          COUNT(*) FILTER (WHERE submission_number = 1)::int AS new_votes,
          COUNT(*) FILTER (WHERE submission_number > 1)::int AS changed_votes
        FROM ballot_submissions bs
        ${electionFilter}
        GROUP BY day
      ), trait_activity AS (
        SELECT
          DATE_TRUNC('day', vto.created_at)::date AS day,
          COUNT(DISTINCT vto.voter_hash)::int AS changed_traits
        FROM voter_trait_options vto
        GROUP BY day
      )
      SELECT
        COALESCE(va.day, ta.day) AS day,
        COALESCE(va.new_votes, 0)::int AS new_votes,
        COALESCE(va.changed_votes, 0)::int AS changed_votes,
        COALESCE(ta.changed_traits, 0)::int AS changed_traits
      FROM vote_activity va
      FULL OUTER JOIN trait_activity ta ON ta.day = va.day
      ORDER BY day
    `, params);

    const rankingDepthRows = await query(`
      WITH depths AS (
        SELECT br.ballot_submission_id, COUNT(*)::int AS ranking_depth
        FROM ballot_rankings br
        JOIN ballot_submissions bs ON bs.ballot_submission_id = br.ballot_submission_id
        ${electionFilter}
        GROUP BY br.ballot_submission_id
      )
      SELECT ranking_depth, COUNT(*)::int AS ballots
      FROM depths
      GROUP BY ranking_depth
      ORDER BY ranking_depth
    `, params);

    const transitionRows = await query(`
      WITH first_prefs AS (
        SELECT
          bs.election_id,
          bs.voter_hash,
          bs.submission_number,
          ec.display_name AS candidate
        FROM ballot_submissions bs
        JOIN ballot_rankings br
          ON br.ballot_submission_id = bs.ballot_submission_id
         AND br.rank_position = 1
        JOIN election_candidates ec ON ec.candidate_id = br.candidate_id
        ${electionFilter}
      ), switches AS (
        SELECT
          voter_hash,
          LAG(candidate) OVER (PARTITION BY election_id, voter_hash ORDER BY submission_number) AS previous_candidate,
          candidate AS new_candidate
        FROM first_prefs
      )
      SELECT previous_candidate, new_candidate, COUNT(*)::int AS switch_count
      FROM switches
      WHERE previous_candidate IS NOT NULL
        AND previous_candidate <> new_candidate
      GROUP BY previous_candidate, new_candidate
      ORDER BY switch_count DESC
    `, params);

    const transitionOverTimeRows = await query(`
      WITH first_prefs AS (
        SELECT
          bs.election_id,
          bs.voter_hash,
          bs.submission_number,
          bs.submitted_at,
          ec.display_name AS candidate
        FROM ballot_submissions bs
        JOIN ballot_rankings br
          ON br.ballot_submission_id = bs.ballot_submission_id
         AND br.rank_position = 1
        JOIN election_candidates ec ON ec.candidate_id = br.candidate_id
        ${electionFilter}
      ), switches AS (
        SELECT
          election_id,
          voter_hash,
          DATE_TRUNC('day', submitted_at)::date AS day,
          LAG(candidate) OVER (PARTITION BY election_id, voter_hash ORDER BY submission_number, submitted_at) AS previous_candidate,
          candidate AS new_candidate
        FROM first_prefs
      )
      SELECT
        day,
        previous_candidate,
        new_candidate,
        CONCAT(previous_candidate, ' → ', new_candidate) AS transition,
        COUNT(*)::int AS switch_count
      FROM switches
      WHERE previous_candidate IS NOT NULL
        AND previous_candidate <> new_candidate
      GROUP BY day, previous_candidate, new_candidate
      ORDER BY day, switch_count DESC
    `, params);

    const traitCandidateRows = await query(`
      WITH current_first AS (
        SELECT
          bs.ballot_submission_id,
          bs.election_id,
          ec.display_name AS candidate
        FROM ballot_submissions bs
        JOIN ballot_rankings br
          ON br.ballot_submission_id = bs.ballot_submission_id
         AND br.rank_position = 1
        JOIN election_candidates ec ON ec.candidate_id = br.candidate_id
        WHERE bs.is_current = TRUE
        ${electionId ? 'AND bs.election_id = $1' : ''}
      ), counts AS (
        SELECT
          CONCAT(t.trait_name, ': ', tro.option_value) AS trait_option,
          cf.candidate,
          COUNT(*)::numeric AS count
        FROM current_first cf
        JOIN ballot_vote bv ON bv.ballot_submission_id = cf.ballot_submission_id
        JOIN trait_options tro ON tro.trait_option_id = bv.trait_option_id
        JOIN traits t ON t.trait_id = tro.trait_id
        JOIN trait_categories tc ON tc.trait_category_id = t.trait_category_id
        WHERE LOWER(COALESCE(tc.category_name, '')) NOT LIKE '%country%'
          AND LOWER(COALESCE(t.trait_name, '')) NOT LIKE '%country%'
          AND LOWER(COALESCE(tc.category_name, '')) NOT LIKE '%origin%'
          AND LOWER(COALESCE(t.trait_name, '')) NOT LIKE '%origin%'
        GROUP BY trait_option, cf.candidate
      ), ranked_traits AS (
        SELECT trait_option, SUM(count) AS total_count
        FROM counts
        GROUP BY trait_option
        ORDER BY total_count DESC
        LIMIT 25
      ), totals AS (
        SELECT c.trait_option, SUM(c.count) AS trait_total
        FROM counts c
        JOIN ranked_traits rt ON rt.trait_option = c.trait_option
        GROUP BY c.trait_option
      )
      SELECT
        c.trait_option,
        c.candidate,
        c.count::int AS count,
        ROUND((c.count / NULLIF(t.trait_total, 0)) * 100, 2)::float AS share_percent
      FROM counts c
      JOIN totals t ON t.trait_option = c.trait_option
      ORDER BY c.trait_option, c.candidate
    `, params);

    const associationRows = await query(`
      WITH current_first AS (
        SELECT
          bs.ballot_submission_id,
          bs.election_id,
          ec.display_name AS candidate
        FROM ballot_submissions bs
        JOIN ballot_rankings br
          ON br.ballot_submission_id = bs.ballot_submission_id
         AND br.rank_position = 1
        JOIN election_candidates ec ON ec.candidate_id = br.candidate_id
        WHERE bs.is_current = TRUE
        ${electionId ? 'AND bs.election_id = $1' : ''}
      ), candidate_totals AS (
        SELECT candidate, COUNT(*)::numeric AS candidate_total
        FROM current_first
        GROUP BY candidate
      ), all_total AS (
        SELECT COUNT(*)::numeric AS n FROM current_first
      ), trait_counts AS (
        SELECT
          CONCAT(t.trait_name, ': ', tro.option_value) AS trait_option,
          cf.candidate,
          COUNT(*)::numeric AS count
        FROM current_first cf
        JOIN ballot_vote bv ON bv.ballot_submission_id = cf.ballot_submission_id
        JOIN trait_options tro ON tro.trait_option_id = bv.trait_option_id
        JOIN traits t ON t.trait_id = tro.trait_id
        JOIN trait_categories tc ON tc.trait_category_id = t.trait_category_id
        WHERE LOWER(COALESCE(tc.category_name, '')) NOT LIKE '%country%'
          AND LOWER(COALESCE(t.trait_name, '')) NOT LIKE '%country%'
          AND LOWER(COALESCE(tc.category_name, '')) NOT LIKE '%origin%'
          AND LOWER(COALESCE(t.trait_name, '')) NOT LIKE '%origin%'
        GROUP BY trait_option, cf.candidate
      ), trait_totals AS (
        SELECT trait_option, SUM(count) AS trait_total
        FROM trait_counts
        GROUP BY trait_option
        ORDER BY trait_total DESC
        LIMIT 25
      )
      SELECT
        tc.trait_option,
        tc.candidate,
        ROUND(((tc.count / NULLIF(tt.trait_total, 0)) - (ct.candidate_total / NULLIF(at.n, 0))) * 100, 2)::float AS association_score
      FROM trait_counts tc
      JOIN trait_totals tt ON tt.trait_option = tc.trait_option
      JOIN candidate_totals ct ON ct.candidate = tc.candidate
      CROSS JOIN all_total at
      ORDER BY tc.trait_option, tc.candidate
    `, params);

    res.json({
      elections: electionsWithParticipation,
      selectedElectionId: electionId,
      stackedMomentum: momentumRows,
      candidateSupport: supportRows,
      dailyActivity: activityRows,
      rankingDepth: rankingDepthRows,
      revoteTransitions: transitionRows,
      revoteTransitionsOverTime: transitionOverTimeRows,
      traitCandidateHeatmap: traitCandidateRows,
      candidateTraitAssociation: associationRows
    });
  } catch (err) {
    console.error('[admin/analytics/data-science]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;

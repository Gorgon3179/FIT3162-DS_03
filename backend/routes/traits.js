// routes/traits.js
// Trait submission — stores trait_option_ids (normalized), not text values

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

// ─── GET /api/trait-options ───────────────────────────────────────────────────
// Public: returns all trait categories, traits, and options for the frontend form
router.get('/trait-options', async (req, res) => {
  try {
    const rows = await query(`
      SELECT
        tc.trait_category_id,
        tc.category_name,
        tc.display_order AS cat_order,
        t.trait_id,
        t.trait_name,
        t.is_required,
        t.display_order AS trait_order,
        tro.trait_option_id,
        tro.option_value,
        tro.display_order AS opt_order
      FROM trait_categories tc
      JOIN traits t ON t.trait_category_id = tc.trait_category_id
      JOIN trait_options tro ON tro.trait_id = t.trait_id
      ORDER BY tc.display_order, t.display_order, tro.display_order
    `);

    // Group into categories → traits → options
    const categoriesMap = {};
    for (const row of rows) {
      const catId = row.trait_category_id;
      if (!categoriesMap[catId]) {
        categoriesMap[catId] = {
          trait_category_id: catId,
          category_name: row.category_name,
          traits: {}
        };
      }
      const traitId = row.trait_id;
      if (!categoriesMap[catId].traits[traitId]) {
        categoriesMap[catId].traits[traitId] = {
          trait_id: traitId,
          trait_name: row.trait_name,
          is_required: row.is_required,
          options: []
        };
      }
      categoriesMap[catId].traits[traitId].options.push({
        trait_option_id: row.trait_option_id,
        option_value: row.option_value
      });
    }

    // Convert to arrays
    const categories = Object.values(categoriesMap).map(cat => ({
      ...cat,
      traits: Object.values(cat.traits)
    }));

    res.json({ categories });
  } catch (err) {
    console.error('[traits/trait-options]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── POST /api/traits ─────────────────────────────────────────────────────────
// Submit or update voter traits — mark old as is_current=FALSE, insert new
// Body: { trait_option_ids: [4, 10, 23] }
router.post('/', authenticate, async (req, res) => {
  try {
    const { voterHash } = req.user;
    const { trait_option_ids } = req.body;

    if (!trait_option_ids || !Array.isArray(trait_option_ids) || trait_option_ids.length === 0) {
      return res.status(400).json({ error: 'trait_option_ids array is required.' });
    }

    if (!trait_option_ids.every(id => Number.isInteger(id) && id > 0)) {
      return res.status(400).json({ error: 'trait_option_ids must be an array of positive integers.' });
    }

    // Mark all current traits as inactive
    await query(
      'UPDATE voter_trait_options SET is_current = FALSE, last_updated_at = NOW() WHERE voter_hash = $1 AND is_current = TRUE',
      [voterHash]
    );

    // Insert each new option as current
    for (const optionId of trait_option_ids) {
      await query(
        'INSERT INTO voter_trait_options (voter_hash, trait_option_id, is_current) VALUES ($1, $2, TRUE)',
        [voterHash, optionId]
      );
    }

    res.json({ message: 'Traits saved.' });
  } catch (err) {
    console.error('[traits/post]', err);
    if (err.code === '23503') {
      return res.status(400).json({ error: 'One or more trait_option_ids are invalid.' });
    }
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Duplicate trait option submitted.' });
    }
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── GET /api/traits ──────────────────────────────────────────────────────────
// Get current voter's trait_option_ids
router.get('/', authenticate, async (req, res) => {
  try {
    const { voterHash } = req.user;

    const rows = await query(
      'SELECT trait_option_id FROM voter_trait_options WHERE voter_hash = $1 AND is_current = TRUE ORDER BY trait_option_id',
      [voterHash]
    );

    res.json({ trait_option_ids: rows.map(r => r.trait_option_id) });
  } catch (err) {
    console.error('[traits/get]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;

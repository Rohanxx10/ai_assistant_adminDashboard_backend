const express = require('express');
const supabase = require('../config/supabase');
const { requireUser } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

// ------------------------------------------------------------
// POST /api/search-history  (desktop app logs every query + AI answer)
// body: { query, answer }
// ------------------------------------------------------------
router.post('/', requireUser, async (req, res) => {
  try {
    const { query, answer } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });

    const { data, error } = await supabase
      .from('search_history')
      .insert({ user_id: req.userId, query, answer: answer || null })
      .select()
      .single();

    if (error) throw error;

    // Keep last_seen fresh whenever the user actively uses the app.
    await supabase
      .from('app_users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', req.userId);

    return res.status(201).json({ entry: data });
  } catch (err) {
    console.error('log search error', err);
    return res.status(500).json({ error: 'Could not save search history' });
  }
});

// GET /api/search-history/mine  (desktop app - user views own history)
router.get('/mine', requireUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('search_history')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;
    return res.json({ history: data });
  } catch (err) {
    console.error('list my search history error', err);
    return res.status(500).json({ error: 'Could not load history' });
  }
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// GET /api/search-history  (admin - all users, most recent first, optional ?userId=)
router.get('/', requireAdmin, async (req, res) => {
  try {
    let query = supabase
      .from('search_history')
      .select('*, app_users(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(500);

    if (req.query.userId) {
      query = query.eq('user_id', req.query.userId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return res.json({ history: data });
  } catch (err) {
    console.error('admin list search history error', err);
    return res.status(500).json({ error: 'Could not load search history' });
  }
});

module.exports = router;

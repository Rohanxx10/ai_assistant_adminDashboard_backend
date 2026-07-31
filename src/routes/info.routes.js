const express = require('express');
const supabase = require('../config/supabase');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

// ------------------------------------------------------------
// GET /api/app-info
// PUBLIC (no token required) — desktop app fetches this to show
// "how to use", "about", "FAQ", etc. Returns every info page.
// ------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('app_info')
      .select('slug, title, content, updated_at')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return res.json({ pages: data });
  } catch (err) {
    console.error('list app info error', err);
    return res.status(500).json({ error: 'Could not load app info' });
  }
});

// ------------------------------------------------------------
// GET /api/app-info/:slug
// PUBLIC — fetch a single page, e.g. /api/app-info/how-to-use
// ------------------------------------------------------------
router.get('/:slug', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('app_info')
      .select('slug, title, content, updated_at')
      .eq('slug', req.params.slug)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No info page with that slug' });

    return res.json({ page: data });
  } catch (err) {
    console.error('get app info error', err);
    return res.status(500).json({ error: 'Could not load app info' });
  }
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// POST /api/app-info  (admin - create a new page)
// body: { slug, title, content }
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { slug, title, content } = req.body;
    if (!slug || !title || !content) {
      return res.status(400).json({ error: 'slug, title and content are required' });
    }

    const cleanSlug = slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const { data, error } = await supabase
      .from('app_info')
      .insert({ slug: cleanSlug, title, content })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ page: data });
  } catch (err) {
    console.error('create app info error', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A page with this slug already exists' });
    }
    return res.status(500).json({ error: 'Could not create page' });
  }
});

// PUT /api/app-info/:slug  (admin - update title/content of an existing page,
// or create it if it doesn't exist yet — makes editing "how-to-use" simple)
// body: { title, content }
router.put('/:slug', requireAdmin, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const { data, error } = await supabase
      .from('app_info')
      .upsert(
        { slug: req.params.slug, title, content, updated_at: new Date().toISOString() },
        { onConflict: 'slug' }
      )
      .select()
      .single();

    if (error) throw error;
    return res.json({ page: data });
  } catch (err) {
    console.error('update app info error', err);
    return res.status(500).json({ error: 'Could not update page' });
  }
});

// DELETE /api/app-info/:slug  (admin)
router.delete('/:slug', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('app_info').delete().eq('slug', req.params.slug);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error('delete app info error', err);
    return res.status(500).json({ error: 'Could not delete page' });
  }
});

module.exports = router;

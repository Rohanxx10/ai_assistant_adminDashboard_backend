const express = require('express');
const supabase = require('../config/supabase');
const { requireUser } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

// ------------------------------------------------------------
// GET /api/notifications
// Desktop app should poll this INFREQUENTLY (e.g. once every
// 30-60 minutes, or once per app launch) - not a websocket feed.
// Returns unread notifications for this user + any broadcast ones.
// ------------------------------------------------------------
router.get('/', requireUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .or(`user_id.eq.${req.userId},user_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    return res.json({ notifications: data });
  } catch (err) {
    console.error('list notifications error', err);
    return res.status(500).json({ error: 'Could not load notifications' });
  }
});

// PATCH /api/notifications/:id/read  (desktop app marks as read)
router.patch('/:id/read', requireUser, async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error('mark notification read error', err);
    return res.status(500).json({ error: 'Could not update notification' });
  }
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// GET /api/notifications/admin/all  (admin - view everything sent)
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*, app_users(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return res.json({ notifications: data });
  } catch (err) {
    console.error('admin list notifications error', err);
    return res.status(500).json({ error: 'Could not load notifications' });
  }
});

// POST /api/notifications/admin/send  (admin sends a manual notification)
// body: { userId (optional, omit to broadcast to everyone), title, message, type }
router.post('/admin/send', requireAdmin, async (req, res) => {
  try {
    const { userId, title, message, type } = req.body;
    if (!title || !message) {
      return res.status(400).json({ error: 'title and message are required' });
    }

    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId || null,
        title,
        message,
        type: type || 'general',
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ notification: data });
  } catch (err) {
    console.error('admin send notification error', err);
    return res.status(500).json({ error: 'Could not send notification' });
  }
});

module.exports = router;

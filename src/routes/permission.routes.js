const express = require('express');
const supabase = require('../config/supabase');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

// ------------------------------------------------------------
// GET /api/permission
// THE KILL SWITCH. Desktop app calls this on startup and
// periodically (e.g. every few minutes). If runnable === false
// or is_active === false, the desktop app should stop working
// (lock its features) until it becomes true again.
// ------------------------------------------------------------
router.get('/', requireUser, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('app_users')
      .select('runnable, is_active')
      .eq('id', req.userId)
      .single();

    if (error) throw error;

    const runnable = Boolean(user.runnable) && Boolean(user.is_active);

    return res.json({
      runnable,
      reason: !user.is_active
        ? 'account_disabled'
        : !user.runnable
        ? 'payment_or_activation_required'
        : null,
    });
  } catch (err) {
    console.error('permission check error', err);
    // Fail-safe: if the check itself fails, tell the app to stop rather than run unlicensed.
    return res.status(500).json({ runnable: false, reason: 'server_error' });
  }
});

module.exports = router;

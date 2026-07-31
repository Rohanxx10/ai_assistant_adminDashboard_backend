const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { signUserToken } = require('../utils/jwt');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

// ------------------------------------------------------------
// POST /api/auth/register
// Called once by the desktop app when the user first registers.
// body: { fullName, email, phone, password, deviceId }
// ------------------------------------------------------------
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, password, deviceId } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'fullName, email and password are required' });
    }

    const { data: existing } = await supabase
      .from('app_users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data: user, error } = await supabase
      .from('app_users')
      .insert({
        full_name: fullName,
        email: email.toLowerCase().trim(),
      
        password_hash: passwordHash,
        device_id: deviceId || null,
        runnable: false, // new users start locked until a transaction is approved / free coupon applied
      })
      .select()
      .single();

    if (error) throw error;

    // Send the one automatic notification: welcome. No other auto notifications are sent.
    await supabase.from('notifications').insert({
      user_id: user.id,
      title: 'Welcome 👋',
      message: `Hi ${fullName}, thanks for registering! Complete your payment (or apply a coupon) to activate the app.`,
      type: 'welcome',
    });

    const token = signUserToken({ userId: user.id });

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        runnable: user.runnable,
      },
    });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// ------------------------------------------------------------
// POST /api/auth/login
// body: { email, password }
// ------------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const { data: user, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (error) throw error;
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been disabled by the admin' });
    }

    await supabase
      .from('app_users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', user.id);

    const token = signUserToken({ userId: user.id });

    return res.json({
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        runnable: user.runnable,
      },
    });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// ------------------------------------------------------------
// POST /api/auth/heartbeat
// Desktop app calls this every few minutes while running so the
// admin dashboard can show "online now" without websockets.
// ------------------------------------------------------------
router.post('/heartbeat', requireUser, async (req, res) => {
  try {
    await supabase
      .from('app_users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', req.userId);

    return res.json({ ok: true });
  } catch (err) {
    console.error('heartbeat error', err);
    return res.status(500).json({ error: 'Heartbeat failed' });
  }
});

// ------------------------------------------------------------
// GET /api/auth/me  -> basic profile + current runnable flag
// ------------------------------------------------------------
router.get('/me', requireUser, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('app_users')
      .select('id, full_name, email, phone, runnable, is_active, created_at')
      .eq('id', req.userId)
      .single();

    if (error) throw error;
    return res.json({ user });
  } catch (err) {
    console.error('me error', err);
    return res.status(500).json({ error: 'Could not load profile' });
  }
});

module.exports = router;

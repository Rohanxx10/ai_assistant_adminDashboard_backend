const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { signAdminToken } = require('../utils/jwt');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

// Online timeout – configurable via .env, default 30 seconds (0.5 minutes)
const ONLINE_WINDOW_MINUTES = parseFloat(process.env.ONLINE_TIMEOUT_MINUTES) || 0.5;

// ------------------------------------------------------------
// POST /api/admin/setup-first-admin
// One-time bootstrap route to create your first admin login.
// Requires FIRST_ADMIN_SETUP_KEY from the .env file as a shared secret.
// Disable or remove this route after you've created your admin account.
// body: { setupKey, username, password }
// ------------------------------------------------------------
router.post('/setup-first-admin', async (req, res) => {
  try {
    const { setupKey, username, password } = req.body;

    if (!setupKey || setupKey !== process.env.FIRST_ADMIN_SETUP_KEY) {
      return res.status(403).json({ error: 'Invalid setup key' });
    }
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const { count } = await supabase
      .from('admin_users')
      .select('*', { count: 'exact', head: true });

    if (count && count > 0) {
      return res.status(409).json({ error: 'An admin account already exists. Use /login instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { data: admin, error } = await supabase
      .from('admin_users')
      .insert({ username, password_hash: passwordHash })
      .select()
      .single();

    if (error) throw error;

    const token = signAdminToken({ adminId: admin.id, username: admin.username });
    return res.status(201).json({ token, admin: { id: admin.id, username: admin.username } });
  } catch (err) {
    console.error('setup first admin error', err);
    return res.status(500).json({ error: 'Could not create admin account' });
  }
});

// ------------------------------------------------------------
// POST /api/admin/login
// ------------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const { data: admin, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('username', username)
      .maybeSingle();

    if (error) throw error;
    if (!admin) return res.status(401).json({ error: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    const token = signAdminToken({ adminId: admin.id, username: admin.username });
    return res.json({ token, admin: { id: admin.id, username: admin.username } });
  } catch (err) {
    console.error('admin login error', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// ------------------------------------------------------------
// GET /api/admin/dashboard  (summary stats for the dashboard home page)
// ------------------------------------------------------------
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const onlineSince = new Date(Date.now() - ONLINE_WINDOW_MINUTES * 60 * 1000).toISOString();

    const [
      { count: totalUsers },
      { count: onlineUsers },
      { count: activatedUsers },
      { count: pendingTransactions },
      { count: approvedTransactions },
      { count: rejectedTransactions },
      { count: totalTransactions },
      { data: recentTxns },
      { data: recentSearches },
    ] = await Promise.all([
      supabase.from('app_users').select('*', { count: 'exact', head: true }),
      supabase
        .from('app_users')
        .select('*', { count: 'exact', head: true })
        .gte('last_seen_at', onlineSince),
      supabase.from('app_users').select('*', { count: 'exact', head: true }).eq('runnable', true),
      supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'approved'),
      supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'rejected'),
      supabase.from('transactions').select('*', { count: 'exact', head: true }),
      supabase
        .from('transactions')
        .select('*, app_users(full_name, email)')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('search_history')
        .select('*, app_users(full_name, email)')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    return res.json({
      totalUsers: totalUsers || 0,
      onlineUsers: onlineUsers || 0,
      activatedUsers: activatedUsers || 0,
      pendingTransactions: pendingTransactions || 0,
      approvedTransactions: approvedTransactions || 0,
      rejectedTransactions: rejectedTransactions || 0,
      totalTransactions: totalTransactions || 0,
      recentTransactions: recentTxns || [],
      recentSearches: recentSearches || [],
    });
  } catch (err) {
    console.error('dashboard stats error', err);
    return res.status(500).json({ error: 'Could not load dashboard' });
  }
});

// ------------------------------------------------------------
// GET /api/admin/users  (list all app users, with computed "online" flag)
// ------------------------------------------------------------
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('app_users')
      .select('id, full_name, email, runnable, is_active, last_seen_at, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const onlineSince = Date.now() - ONLINE_WINDOW_MINUTES * 60 * 1000;
    const enriched = users.map((u) => ({
      ...u,
      online: u.last_seen_at ? new Date(u.last_seen_at).getTime() >= onlineSince : false,
    }));

    return res.json({ users: enriched });
  } catch (err) {
    console.error('list users error', err);
    return res.status(500).json({ error: 'Could not load users' });
  }
});

// ------------------------------------------------------------
// PATCH /api/admin/users/:id  (admin manually toggles runnable / is_active)
// body: { runnable?, isActive? }
// This is the manual kill-switch control: set runnable=false any
// time to immediately stop that user's desktop app on its next check.
// ------------------------------------------------------------
router.patch('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { runnable, isActive } = req.body;
    const update = {};
    if (runnable !== undefined) update.runnable = runnable;
    if (isActive !== undefined) update.is_active = isActive;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const { data, error } = await supabase
      .from('app_users')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ user: data });
  } catch (err) {
    console.error('update user error', err);
    return res.status(500).json({ error: 'Could not update user' });
  }
});

// ------------------------------------------------------------
// GET /api/admin/users/:id  (single user detail, joined with their txns/searches)
// ------------------------------------------------------------
router.get('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;

    const [{ data: transactions }, { data: history }] = await Promise.all([
      supabase
        .from('transactions')
        .select('*')
        .eq('user_id', req.params.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('search_history')
        .select('*')
        .eq('user_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    return res.json({ user, transactions: transactions || [], searchHistory: history || [] });
  } catch (err) {
    console.error('user detail error', err);
    return res.status(500).json({ error: 'Could not load user' });
  }
});

module.exports = router;
const express = require('express');
const supabase = require('../config/supabase');
const { requireUser } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

// ============================================================
// DESKTOP APP ENDPOINTS
// ============================================================

// ------------------------------------------------------------
// GET /api/ai-config/list
// Returns EVERY active AI provider, each annotated with this
// user's own usage/availability for it. Use this when you want to
// let the user pick a model, or just see what's on offer. Providers
// the user has maxed out or been blocked from still appear in the
// list (so the UI can show them as disabled) but their apiKey /
// endpoint are omitted since they can't be used right now.
// ------------------------------------------------------------
router.get('/list', requireUser, async (req, res) => {
  try {
    const { data: providers, error } = await supabase
      .from('ai_providers')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const { data: usageRows } = await supabase
      .from('ai_provider_usage')
      .select('*')
      .eq('user_id', req.userId);

    const usageByProvider = new Map((usageRows || []).map((u) => [u.provider_id, u]));

    const list = providers.map((p) => {
      const usage = usageByProvider.get(p.id);
      const usedCount = usage?.used_count || 0;
      const blocked = Boolean(usage?.blocked);
      const overLimit = p.request_limit !== null && usedCount >= p.request_limit;
      const available = !blocked && !overLimit;

      return {
        id: p.id,
        name: p.name,
        model: p.model,
        requestLimit: p.request_limit,
        used: usedCount,
        available,
        reason: blocked ? 'user_blocked' : overLimit ? 'usage_limit_reached' : null,
        // Only hand over the credentials needed to actually call this
        // provider if the user is currently allowed to use it.
        ...(available ? { endpoint: p.endpoint, apiKey: p.api_key } : {}),
      };
    });

    return res.json({ providers: list });
  } catch (err) {
    console.error('list ai-config error', err);
    return res.status(500).json({ error: 'Could not load AI providers' });
  }
});

// ------------------------------------------------------------
// GET /api/ai-config
// Back-compat single-provider fetch — returns the most recently
// created active provider this user can still use. Prefer
// GET /api/ai-config/list if you want to let the user choose.
// ------------------------------------------------------------
router.get('/', requireUser, async (req, res) => {
  try {
    const { data: provider, error } = await supabase
      .from('ai_providers')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!provider) {
      return res.status(404).json({ error: 'No active AI provider is configured right now' });
    }

    const { data: usage } = await supabase
      .from('ai_provider_usage')
      .select('*')
      .eq('provider_id', provider.id)
      .eq('user_id', req.userId)
      .maybeSingle();

    if (usage?.blocked) {
      return res.status(403).json({
        error: 'This provider has been disabled for your account by the admin',
        reason: 'user_blocked',
      });
    }

    const usedCount = usage?.used_count || 0;
    if (provider.request_limit !== null && usedCount >= provider.request_limit) {
      return res.status(403).json({
        error: 'You have reached your request limit for this provider',
        reason: 'usage_limit_reached',
        used: usedCount,
        limit: provider.request_limit,
      });
    }

    return res.json({
      provider: {
        name: provider.name,
        endpoint: provider.endpoint,
        apiKey: provider.api_key,
        model: provider.model,
      },
      usage: {
        used: usedCount,
        limit: provider.request_limit, // null = unlimited
      },
    });
  } catch (err) {
    console.error('get ai-config error', err);
    return res.status(500).json({ error: 'Could not load AI config' });
  }
});

// ------------------------------------------------------------
// POST /api/ai-config/log-use
// Desktop app calls this AFTER it successfully makes a request to
// the AI provider, so usage is counted accurately (not just on
// fetch). This is what actually increments the per-user counter
// that GET /api/ai-config checks against.
// ------------------------------------------------------------
router.post('/log-use', requireUser, async (req, res) => {
  try {
    let providerId = req.body?.providerId;

    if (!providerId) {
      // Legacy fallback: no providerId given, use the same "most recent
      // active provider" logic as GET /api/ai-config.
      const { data: fallback, error: fallbackErr } = await supabase
        .from('ai_providers')
        .select('id')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fallbackErr) throw fallbackErr;
      if (!fallback) return res.status(404).json({ error: 'No active AI provider is configured' });
      providerId = fallback.id;
    }

    const { data: existing } = await supabase
      .from('ai_provider_usage')
      .select('*')
      .eq('provider_id', providerId)
      .eq('user_id', req.userId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('ai_provider_usage')
        .update({ used_count: existing.used_count + 1, last_used_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase.from('ai_provider_usage').insert({
        provider_id: providerId,
        user_id: req.userId,
        used_count: 1,
        last_used_at: new Date().toISOString(),
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('log ai use error', err);
    return res.status(500).json({ error: 'Could not log usage' });
  }
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// GET /api/ai-providers  (admin - list all providers)
router.get('/admin/providers', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ai_providers')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ providers: data });
  } catch (err) {
    console.error('list ai providers error', err);
    return res.status(500).json({ error: 'Could not load providers' });
  }
});

// POST /api/ai-providers  (admin - create)
// body: { name, endpoint, apiKey, model, requestLimit, isActive }
router.post('/admin/providers', requireAdmin, async (req, res) => {
  try {
    const { name, endpoint, apiKey, model, requestLimit, isActive } = req.body;
    if (!name || !endpoint || !apiKey || !model) {
      return res.status(400).json({ error: 'name, endpoint, apiKey and model are required' });
    }

    const { data, error } = await supabase
      .from('ai_providers')
      .insert({
        name,
        endpoint,
        api_key: apiKey,
        model,
        request_limit: requestLimit === undefined || requestLimit === '' ? null : Number(requestLimit),
        is_active: isActive !== undefined ? isActive : true,
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ provider: data });
  } catch (err) {
    console.error('create ai provider error', err);
    return res.status(500).json({ error: 'Could not create provider' });
  }
});

// PATCH /api/ai-providers/:id  (admin - edit / toggle active)
router.patch('/admin/providers/:id', requireAdmin, async (req, res) => {
  try {
    const { name, endpoint, apiKey, model, requestLimit, isActive } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (endpoint !== undefined) update.endpoint = endpoint;
    if (apiKey !== undefined) update.api_key = apiKey;
    if (model !== undefined) update.model = model;
    if (requestLimit !== undefined) update.request_limit = requestLimit === '' ? null : Number(requestLimit);
    if (isActive !== undefined) update.is_active = isActive;

    const { data, error } = await supabase
      .from('ai_providers')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ provider: data });
  } catch (err) {
    console.error('update ai provider error', err);
    return res.status(500).json({ error: 'Could not update provider' });
  }
});

// DELETE /api/ai-providers/:id  (admin)
router.delete('/admin/providers/:id', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('ai_providers').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error('delete ai provider error', err);
    return res.status(500).json({ error: 'Could not delete provider' });
  }
});

// GET /api/ai-providers/:id/usage  (admin - see every user's usage on this provider)
router.get('/admin/providers/:id/usage', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ai_provider_usage')
      .select('*, app_users(full_name, email)')
      .eq('provider_id', req.params.id)
      .order('used_count', { ascending: false });

    if (error) throw error;
    return res.json({ usage: data });
  } catch (err) {
    console.error('provider usage error', err);
    return res.status(500).json({ error: 'Could not load usage' });
  }
});

// PATCH /api/ai-providers/:id/usage/:userId  (admin - block/unblock or reset ONE user on ONE provider)
// body: { blocked?, resetCount? }
router.patch('/admin/providers/:id/usage/:userId', requireAdmin, async (req, res) => {
  try {
    const { blocked, resetCount } = req.body;

    const { data: existing } = await supabase
      .from('ai_provider_usage')
      .select('*')
      .eq('provider_id', req.params.id)
      .eq('user_id', req.params.userId)
      .maybeSingle();

    const update = {};
    if (blocked !== undefined) update.blocked = blocked;
    if (resetCount) update.used_count = 0;

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('ai_provider_usage')
        .update(update)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('ai_provider_usage')
        .insert({
          provider_id: req.params.id,
          user_id: req.params.userId,
          used_count: 0,
          blocked: blocked || false,
        })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    return res.json({ usage: result });
  } catch (err) {
    console.error('update provider usage error', err);
    return res.status(500).json({ error: 'Could not update usage record' });
  }
});

module.exports = router;

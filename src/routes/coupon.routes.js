const express = require('express');
const supabase = require('../config/supabase');
const { requireUser } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

// ------------------------------------------------------------
// POST /api/coupons/validate  (desktop app checks a code before submitting)
// body: { code }
// ------------------------------------------------------------
router.post('/validate', requireUser, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'code is required' });

    const { data: coupon, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .maybeSingle();

    if (error) throw error;
    if (!coupon || !coupon.active) {
      return res.status(404).json({ valid: false, error: 'Invalid or inactive coupon' });
    }
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return res.status(400).json({ valid: false, error: 'Coupon expired' });
    }
    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
      return res.status(400).json({ valid: false, error: 'Coupon usage limit reached' });
    }

    return res.json({
      valid: true,
      discountPercent: Number(coupon.discount_percent),
      freeOfCharge: Number(coupon.discount_percent) >= 100,
    });
  } catch (err) {
    console.error('validate coupon error', err);
    return res.status(500).json({ error: 'Could not validate coupon' });
  }
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// GET /api/coupons  (admin - list all)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('coupons')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ coupons: data });
  } catch (err) {
    console.error('list coupons error', err);
    return res.status(500).json({ error: 'Could not load coupons' });
  }
});

// POST /api/coupons  (admin - create)
// body: { code, discountPercent, maxUses, expiresAt }
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { code, discountPercent, maxUses, expiresAt } = req.body;
    if (!code || discountPercent === undefined) {
      return res.status(400).json({ error: 'code and discountPercent are required' });
    }
    if (discountPercent < 0 || discountPercent > 100) {
      return res.status(400).json({ error: 'discountPercent must be between 0 and 100' });
    }

    const { data, error } = await supabase
      .from('coupons')
      .insert({
        code: code.trim().toUpperCase(),
        discount_percent: discountPercent,
        max_uses: maxUses ?? null,
        expires_at: expiresAt || null,
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ coupon: data });
  } catch (err) {
    console.error('create coupon error', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A coupon with this code already exists' });
    }
    return res.status(500).json({ error: 'Could not create coupon' });
  }
});

// PATCH /api/coupons/:id  (admin - toggle active / edit)
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const { active, discountPercent, maxUses, expiresAt } = req.body;
    const update = {};
    if (active !== undefined) update.active = active;
    if (discountPercent !== undefined) update.discount_percent = discountPercent;
    if (maxUses !== undefined) update.max_uses = maxUses;
    if (expiresAt !== undefined) update.expires_at = expiresAt;

    const { data, error } = await supabase
      .from('coupons')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ coupon: data });
  } catch (err) {
    console.error('update coupon error', err);
    return res.status(500).json({ error: 'Could not update coupon' });
  }
});

// DELETE /api/coupons/:id  (admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('coupons').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error('delete coupon error', err);
    return res.status(500).json({ error: 'Could not delete coupon' });
  }
});

module.exports = router;

const express = require('express');
const supabase = require('../config/supabase');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

// Fixed row id so there's always exactly one pricing record (seeded in schema.sql).
const PRICING_ROW_ID = '00000000-0000-0000-0000-000000000001';

// ------------------------------------------------------------
// GET /api/price
// PUBLIC (no token required) — desktop app calls this to show
// the current price before the user pays / submits a transaction.
// ------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('app_pricing')
      .select('amount, currency, label, updated_at')
      .eq('id', PRICING_ROW_ID)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      // Fallback in case the seed row was never created.
      return res.json({ amount: 0, currency: 'INR', label: 'App activation', updated_at: null });
    }

    return res.json(data);
  } catch (err) {
    console.error('get price error', err);
    return res.status(500).json({ error: 'Could not load price' });
  }
});

// ------------------------------------------------------------
// PUT /api/price   (admin - update the price)
// body: { amount, currency, label }
// ------------------------------------------------------------
router.put('/', requireAdmin, async (req, res) => {
  try {
    const { amount, currency, label } = req.body;

    if (amount === undefined || Number(amount) < 0) {
      return res.status(400).json({ error: 'amount is required and must be 0 or more' });
    }

    const { data, error } = await supabase
      .from('app_pricing')
      .upsert(
        {
          id: PRICING_ROW_ID,
          amount: Number(amount),
          currency: currency || 'INR',
          label: label || 'App activation',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select()
      .single();

    if (error) throw error;
    return res.json({ price: data });
  } catch (err) {
    console.error('update price error', err);
    return res.status(500).json({ error: 'Could not update price' });
  }
});

module.exports = router;

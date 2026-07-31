const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireUser } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

// Screenshots are received as multipart/form-data and streamed to Supabase Storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed for the UPI screenshot'));
    }
    cb(null, true);
  },
});

async function uploadScreenshot(file) {
  if (!file) return null;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'upi-screenshots';
  const ext = (file.originalname.split('.').pop() || 'png').toLowerCase();
  const path = `${uuidv4()}.${ext}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// ------------------------------------------------------------
// POST /api/transactions   (desktop app, user submits payment proof)
// multipart/form-data: transactionNo, upiId, amount, couponCode, screenshot(file)
// ------------------------------------------------------------
router.post('/', requireUser, upload.single('screenshot'), async (req, res) => {
  try {
    const { transactionNo, upiId, amount, couponCode } = req.body;

    if (!transactionNo) {
      return res.status(400).json({ error: 'transactionNo is required' });
    }

    let discountPercent = 0;
    let couponRow = null;

    if (couponCode) {
      const { data: coupon } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', couponCode.trim().toUpperCase())
        .maybeSingle();

      if (!coupon || !coupon.active) {
        return res.status(400).json({ error: 'Invalid or inactive coupon code' });
      }
      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        return res.status(400).json({ error: 'This coupon has expired' });
      }
      if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
        return res.status(400).json({ error: 'This coupon has reached its usage limit' });
      }

      couponRow = coupon;
      discountPercent = Number(coupon.discount_percent);
    }

    const baseAmount = Number(amount) || 0;
    const finalAmount = Math.max(0, +(baseAmount * (1 - discountPercent / 100)).toFixed(2));

    const screenshotUrl = await uploadScreenshot(req.file);

    // 100% discount coupon => no payment needed, auto-approve and unlock immediately.
    const autoApprove = discountPercent >= 100;

    const { data: txn, error } = await supabase
      .from('transactions')
      .insert({
        user_id: req.userId,
        transaction_no: transactionNo,
        upi_id: upiId || null,
        amount: baseAmount,
        coupon_code: couponRow ? couponRow.code : null,
        discount_percent: discountPercent,
        final_amount: finalAmount,
        screenshot_url: screenshotUrl,
        status: autoApprove ? 'approved' : 'pending',
        reviewed_at: autoApprove ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) throw error;

    if (couponRow) {
      await supabase
        .from('coupons')
        .update({ used_count: couponRow.used_count + 1 })
        .eq('id', couponRow.id);
    }

    if (autoApprove) {
      await supabase.from('app_users').update({ runnable: true }).eq('id', req.userId);
    }

    return res.status(201).json({ transaction: txn });
  } catch (err) {
    console.error('submit transaction error', err);
    return res.status(500).json({ error: err.message || 'Could not submit transaction' });
  }
});

// ------------------------------------------------------------
// GET /api/transactions/mine  (desktop app - user's own history)
// ------------------------------------------------------------
router.get('/mine', requireUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ transactions: data });
  } catch (err) {
    console.error('list my transactions error', err);
    return res.status(500).json({ error: 'Could not load transactions' });
  }
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// GET /api/transactions  (admin - list all, with optional ?status=pending)
router.get('/', requireAdmin, async (req, res) => {
  try {
    let query = supabase
      .from('transactions')
      .select('*, app_users(full_name, email)')
      .order('created_at', { ascending: false });

    if (req.query.status) {
      query = query.eq('status', req.query.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return res.json({ transactions: data });
  } catch (err) {
    console.error('admin list transactions error', err);
    return res.status(500).json({ error: 'Could not load transactions' });
  }
});

// PATCH /api/transactions/:id  (admin approves or rejects)
// body: { status: 'approved' | 'rejected', adminNote }
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
    }

    const { data: txn, error } = await supabase
      .from('transactions')
      .update({ status, admin_note: adminNote || null, reviewed_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    // Approving a transaction is what flips the kill-switch back on.
    if (status === 'approved') {
      await supabase.from('app_users').update({ runnable: true }).eq('id', txn.user_id);
    }

    return res.json({ transaction: txn });
  } catch (err) {
    console.error('review transaction error', err);
    return res.status(500).json({ error: 'Could not update transaction' });
  }
});

module.exports = router;

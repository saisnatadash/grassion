'use strict';
const express   = require('express');
const Razorpay  = require('razorpay');
const crypto    = require('crypto');
const db        = require('../lib/db');
const authMw    = require('../middleware/auth');

const router = express.Router();

// Keys come ONLY from environment variables — never hardcoded
function getRazorpay() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
    throw new Error('Razorpay keys not configured');
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

const PLANS = {
  pro:  { name: 'Pro',  amountPaise: 290000,  amountINR: 2900,  months: 1 },
  team: { name: 'Team', amountPaise: 990000,  amountINR: 9900,  months: 1 },
};

// ── CREATE ORDER ─────────────────────────────────────────────────────────────
router.post('/create-order', authMw, async (req, res) => {
  const { plan } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  try {
    const rzp   = getRazorpay();
    const order = await rzp.orders.create({
      amount:   PLANS[plan].amountPaise,
      currency: 'INR',
      receipt:  `grs_${req.userId}_${Date.now()}`,
      notes:    { userId: String(req.userId), plan },
    });
    res.json({
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
      keyId:    process.env.RAZORPAY_KEY_ID,
      planName: PLANS[plan].name,
    });
  } catch (e) {
    console.error('Razorpay order error:', e.message);
    res.status(500).json({ error: 'Payment initialisation failed' });
  }
});

// ── VERIFY PAYMENT ───────────────────────────────────────────────────────────
router.post('/verify', authMw, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  const secret = process.env.RAZORPAY_KEY_SECRET;
  const digest = crypto.createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (digest !== razorpay_signature)
    return res.status(400).json({ error: 'Payment verification failed — signature mismatch' });

  try {
    // Check if user has referral free months
    const userRes = await db.query('SELECT free_months_remaining FROM users WHERE id=$1', [req.userId]);
    const freeMonths = userRes.rows[0]?.free_months_remaining || 0;

    const subEnd = new Date();
    subEnd.setMonth(subEnd.getMonth() + PLANS[plan].months + freeMonths);

    await db.query(
      `UPDATE users
       SET plan=$1, subscription_status='active',
           subscription_end_date=$2, free_months_remaining=0, updated_at=NOW()
       WHERE id=$3`,
      [plan, subEnd.toISOString(), req.userId]
    );

    await db.query(
      `INSERT INTO payments
       (user_id,razorpay_order_id,razorpay_payment_id,razorpay_signature,amount_paise,amount_inr,plan,billing_period_months,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'success')`,
      [req.userId, razorpay_order_id, razorpay_payment_id, razorpay_signature,
       PLANS[plan].amountPaise, PLANS[plan].amountINR, plan, PLANS[plan].months + freeMonths]
    );

    await db.query(
      `INSERT INTO audit_log (user_id,event_type,event_data) VALUES ($1,'plan_upgraded',$2)`,
      [req.userId, JSON.stringify({ plan, freeMonthsApplied: freeMonths })]
    );

    res.json({ success: true, plan, subscriptionEndDate: subEnd, freeMonthsApplied: freeMonths });
  } catch (e) {
    console.error('Verify error:', e.message);
    res.status(500).json({ error: 'Plan upgrade failed' });
  }
});

// ── GET PLAN ─────────────────────────────────────────────────────────────────
router.get('/plan', authMw, async (req, res) => {
  try {
    const r = await db.query(
      'SELECT plan,subscription_status,subscription_end_date,free_months_remaining FROM users WHERE id=$1',
      [req.userId]
    );
    res.json(r.rows[0] || {});
  } catch { res.status(500).json({ error: 'Failed' }); }
});

// ── PAYMENT HISTORY ───────────────────────────────────────────────────────────
router.get('/history', authMw, async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id,amount_inr,plan,status,created_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC',
      [req.userId]
    );
    res.json(r.rows);
  } catch { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;

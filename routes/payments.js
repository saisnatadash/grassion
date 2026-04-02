const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

router.post('/create-order', authMiddleware, async (req, res) => {
  try {
    const order = await razorpay.orders.create({
      amount: 290000,
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`
    });
    res.json({ success: true, order, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error('Payment error:', err.message);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

router.post('/verify', authMiddleware, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const sign = razorpay_order_id + '|' + razorpay_payment_id;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(sign).digest('hex');
  if (razorpay_signature !== expected) return res.status(400).json({ error: 'Invalid signature' });
  await db.query(
    `UPDATE users SET plan = 'pro', plan_expires = NOW() + INTERVAL '30 days' WHERE id = $1`,
    [req.session.user.id]
  );
  await db.query(
    `INSERT INTO payments (user_id, order_id, payment_id, amount, status) VALUES ($1, $2, $3, $4, 'success')`,
    [req.session.user.id, razorpay_order_id, razorpay_payment_id, 290000]
  );
  req.session.user.plan = 'pro';
  res.json({ success: true });
});

module.exports = router;

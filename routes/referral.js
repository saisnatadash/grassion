const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

router.get('/my-code', authMiddleware, async (req, res) => {
  const result = await db.query('SELECT referral_code FROM users WHERE id = $1', [req.session.user.id]);
  res.json({ code: result.rows[0]?.referral_code });
});

router.post('/apply', authMiddleware, async (req, res) => {
  const { code } = req.body;
  const referrer = await db.query('SELECT id FROM users WHERE referral_code = $1', [code]);
  if (!referrer.rows.length) return res.status(400).json({ error: 'Invalid referral code' });
  await db.query('UPDATE users SET bonus_scans = bonus_scans + 10, referred_by = $1 WHERE id = $2',
    [code, req.session.user.id]);
  await db.query('UPDATE users SET bonus_scans = bonus_scans + 10 WHERE id = $1', [referrer.rows[0].id]);
  res.json({ success: true, message: 'Both you and your friend got 10 bonus scans!' });
});

module.exports = router;

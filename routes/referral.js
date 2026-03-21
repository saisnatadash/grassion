const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

router.get('/my-code', authMiddleware, async (req, res) => {
  try {
    const result = await db.query('SELECT referral_code FROM users WHERE id = $1', [req.session.user.id]);
    res.json({ code: result.rows[0]?.referral_code });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch referral code' });
  }
});

router.post('/apply', authMiddleware, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  try {
    const self = await db.query('SELECT referred_by FROM users WHERE id = $1', [req.session.user.id]);
    if (self.rows[0]?.referred_by) {
      return res.status(400).json({ error: 'You have already applied a referral code' });
    }
    const referrer = await db.query('SELECT id FROM users WHERE referral_code = $1', [code]);
    if (!referrer.rows.length) return res.status(400).json({ error: 'Invalid referral code' });
    if (referrer.rows[0].id === req.session.user.id) {
      return res.status(400).json({ error: 'You cannot use your own referral code' });
    }
    await db.query('UPDATE users SET bonus_scans = bonus_scans + 5, referred_by = $1 WHERE id = $2',
      [code, req.session.user.id]);
    await db.query('UPDATE users SET bonus_scans = bonus_scans + 5 WHERE id = $1',
      [referrer.rows[0].id]);
    res.json({ success: true, message: 'You and your friend each got 5 bonus scans!' });
  } catch (err) {
    console.error('Referral error:', err.message);
    res.status(500).json({ error: 'Failed to apply referral code' });
  }
});

router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT referral_code,
        (SELECT COUNT(*) FROM users WHERE referred_by = u.referral_code) as referral_count,
        bonus_scans
       FROM users u WHERE id = $1`,
      [req.session.user.id]
    );
    const row = result.rows[0] || {};
    res.json({
      code: row.referral_code,
      referral_count: parseInt(row.referral_count) || 0,
      bonus_scans: row.bonus_scans || 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;

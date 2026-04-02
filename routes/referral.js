const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/my-code', auth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT u.referral_code, u.bonus_scans, (SELECT COUNT(*) FROM users WHERE referred_by=u.referral_code) AS signups FROM users u WHERE u.id=$1`,
      [req.session.user.id]
    );
    const row = r.rows[0] || {};
    const signups = parseInt(row.signups) || 0;
    res.json({ code: row.referral_code || null, signups, bonus_earned: signups * 5, total_bonus: row.bonus_scans || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/apply', auth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  try {
    const self = await db.query('SELECT referred_by FROM users WHERE id=$1', [req.session.user.id]);
    if (self.rows[0]?.referred_by) return res.status(400).json({ error: 'Already applied a referral code' });
    const ref = await db.query('SELECT id FROM users WHERE referral_code=$1', [code]);
    if (!ref.rows.length) return res.status(400).json({ error: 'Invalid referral code' });
    if (ref.rows[0].id === req.session.user.id) return res.status(400).json({ error: 'Cannot use your own code' });
    await db.query('UPDATE users SET bonus_scans=bonus_scans+5, referred_by=$1 WHERE id=$2', [code, req.session.user.id]);
    await db.query('UPDATE users SET bonus_scans=bonus_scans+5 WHERE id=$1', [ref.rows[0].id]);
    res.json({ success: true, message: 'You and your friend each got 5 bonus scans! 🎉' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/stats', auth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT u.referral_code, u.bonus_scans, (SELECT COUNT(*) FROM users WHERE referred_by=u.referral_code) AS referral_count FROM users u WHERE u.id=$1`,
      [req.session.user.id]
    );
    const row = r.rows[0] || {};
    res.json({ code: row.referral_code, referral_count: parseInt(row.referral_count) || 0, bonus_scans: row.bonus_scans || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
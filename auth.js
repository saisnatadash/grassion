'use strict';
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const db       = require('../lib/db');
const authMw   = require('../middleware/auth');

const router = express.Router();

function genToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}
function genApiToken()    { return 'grs_' + crypto.randomBytes(32).toString('hex'); }
function genRefCode()     { return crypto.randomBytes(4).toString('hex').toUpperCase(); }

// ── REGISTER ─────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password, name, referredBy } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8)  return res.status(400).json({ error: 'Password must be 8+ characters' });

  try {
    const exists = await db.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already registered' });

    const hash      = await bcrypt.hash(password, 12);
    const apiToken  = genApiToken();
    const refCode   = genRefCode();

    const r = await db.query(
      `INSERT INTO users (email, password_hash, name, api_token, referral_code, referred_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, email, name, plan, api_token, referral_code`,
      [email.toLowerCase(), hash, name || '', apiToken, refCode, referredBy || null]
    );
    const user = r.rows[0];

    // Credit referrer
    if (referredBy) {
      await db.query(
        `UPDATE users SET referral_count = referral_count + 1 WHERE referral_code=$1`,
        [referredBy]
      );
      const referrer = await db.query(`SELECT id, referral_count FROM users WHERE referral_code=$1`, [referredBy]);
      if (referrer.rows.length) {
        const rc = referrer.rows[0].referral_count;
        let reward = null;
        if      (rc === 3)  reward = '1 month Pro free';
        else if (rc === 10) reward = '6 months Pro free';
        else if (rc === 25) reward = 'Pro forever free';
        if (reward) {
          await db.query(`UPDATE users SET free_months_remaining = free_months_remaining + $1 WHERE id=$2`,
            [rc >= 25 ? 999 : rc >= 10 ? 6 : 1, referrer.rows[0].id]);
          await db.query(`INSERT INTO referrals (referrer_code,referrer_id,referred_email,referred_id,status,reward_granted,reward_type,converted_at)
            VALUES ($1,$2,$3,$4,'converted',true,$5,NOW())`,
            [referredBy, referrer.rows[0].id, email.toLowerCase(), user.id, reward]);
        } else {
          await db.query(`INSERT INTO referrals (referrer_code,referrer_id,referred_email,referred_id,status,converted_at)
            VALUES ($1,$2,$3,$4,'converted',NOW())`,
            [referredBy, referrer.rows[0].id, email.toLowerCase(), user.id]);
        }
      }
    }

    await db.query(`INSERT INTO audit_log (user_id,event_type,event_data) VALUES ($1,'user_registered',$2)`,
      [user.id, JSON.stringify({ email: user.email, referredBy: referredBy || null })]);

    res.status(201).json({
      token: genToken(user.id),
      apiToken: user.api_token,
      referralCode: user.referral_code,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const r = await db.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const user = r.rows[0];
    const ok   = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    res.json({
      token: genToken(user.id),
      apiToken: user.api_token,
      referralCode: user.referral_code,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan }
    });
  } catch { res.status(500).json({ error: 'Login failed' }); }
});

// ── ME ────────────────────────────────────────────────────────────────────────
router.get('/me', authMw, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id,email,name,plan,api_token,referral_code,referral_count,
              free_months_remaining,subscription_status,early_access,created_at
       FROM users WHERE id=$1`,
      [req.userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: 'Failed' }); }
});

// ── REGEN API TOKEN ───────────────────────────────────────────────────────────
router.post('/regenerate-token', authMw, async (req, res) => {
  try {
    const t = genApiToken();
    await db.query('UPDATE users SET api_token=$1,updated_at=NOW() WHERE id=$2', [t, req.userId]);
    res.json({ apiToken: t });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

// ── REFERRAL STATS ────────────────────────────────────────────────────────────
router.get('/referral-stats', authMw, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT referral_code,referral_count,free_months_remaining FROM users WHERE id=$1`,
      [req.userId]
    );
    const refs = await db.query(
      `SELECT referred_email,status,reward_type,converted_at FROM referrals WHERE referrer_id=$1 ORDER BY created_at DESC`,
      [req.userId]
    );
    res.json({ ...r.rows[0], referrals: refs.rows });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;

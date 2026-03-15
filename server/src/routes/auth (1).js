'use strict';
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../lib/db');

const router = Router();

// Safe email sender - never blocks or crashes the request
async function trySendEmail(fn) {
  try {
    const { sendVerification, sendPasswordReset } = require('../lib/mailer');
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Email timeout')), 5000));
    await Promise.race([fn(sendVerification, sendPasswordReset), timeout]);
  } catch(e) {
    console.log('Email skipped (non-fatal):', e.message);
  }
}

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const hash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const result = await db.query(
      `INSERT INTO users(email, password_hash, name, verify_token) VALUES($1,$2,$3,$4) RETURNING id, email, name, plan`,
      [email.toLowerCase().trim(), hash, name.trim(), verifyToken]
    );
    const user = result.rows[0];

    const token = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Respond immediately - don't wait for email
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan || 'free' }
    });

    // Send email in background after response
    trySendEmail(async (sendVerification) => {
      await sendVerification(email, name, verifyToken);
    });

    try {
      await db.query(`INSERT INTO audit_log(user_id, action, ip) VALUES($1,'register',$2)`, [user.id, req.ip]);
    } catch {}

  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already registered. Please sign in.' });
    console.error('Register error:', e);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const result = await db.query(
      `SELECT id, email, name, password_hash, plan FROM users WHERE email=$1`,
      [email.toLowerCase().trim()]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid email or password' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan || 'free' }
    });

    try {
      await db.query(`INSERT INTO audit_log(user_id, action, ip) VALUES($1,'login',$2)`, [user.id, req.ip]);
    } catch {}

  } catch(e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

router.get('/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });
  const result = await db.query(
    `UPDATE users SET email_verified=true, verify_token=NULL WHERE verify_token=$1 RETURNING id`,
    [token]
  );
  if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired token' });
  res.redirect(`${process.env.APP_URL || 'https://grassion.com'}/?verified=1`);
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const result = await db.query(`SELECT id, name FROM users WHERE email=$1`, [email.toLowerCase()]);
    if (result.rows.length) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 3600000);
      await db.query(`UPDATE users SET reset_token=$1, reset_expires=$2 WHERE id=$3`, [token, expires, result.rows[0].id]);
      trySendEmail(async (_, sendPasswordReset) => {
        await sendPasswordReset(email, token);
      });
    }
  } catch(e) { console.error('Forgot password error:', e); }
  res.json({ ok: true, message: 'If that email exists, a reset link was sent.' });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  const result = await db.query(`SELECT id FROM users WHERE reset_token=$1 AND reset_expires > NOW()`, [token]);
  if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired token' });
  const hash = await bcrypt.hash(password, 12);
  await db.query(`UPDATE users SET password_hash=$1, reset_token=NULL, reset_expires=NULL WHERE id=$2`, [hash, result.rows[0].id]);
  res.json({ ok: true });
});

router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    await db.query(`UPDATE users SET name=$1, email=$2 WHERE id=$3`, [name, email.toLowerCase(), req.user.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    const result = await db.query(`SELECT password_hash FROM users WHERE id=$1`, [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await db.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [hash, req.user.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

router.delete('/delete-account', requireAuth, async (req, res) => {
  try {
    await db.query(`DELETE FROM users WHERE id=$1`, [req.user.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;

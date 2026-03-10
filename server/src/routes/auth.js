'use strict';
const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../lib/db');
const { sendVerification, sendPasswordReset } = require('../lib/mailer');

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'All fields required' });

    const hash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const result = await db.query(
      `INSERT INTO users(email, password_hash, name, verify_token) VALUES($1,$2,$3,$4) RETURNING id, email, name, plan`,
      [email.toLowerCase(), hash, name, verifyToken]
    );
    const user = result.rows[0];

    try { await sendVerification(email, name, verifyToken); } catch(e) { console.log('Email skipped:', e.message); }

    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, process.env.JWT_SECRET, { expiresIn: '7d' });

    try { await db.query(`INSERT INTO audit_log(user_id, action, ip) VALUES($1,'register',$2)`, [user.id, req.ip]); } catch {}

    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const result = await db.query(
      `SELECT id, email, name, password_hash, plan FROM users WHERE email=$1`,
      [email.toLowerCase()]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, process.env.JWT_SECRET, { expiresIn: '7d' });

    try { await db.query(`INSERT INTO audit_log(user_id, action, ip) VALUES($1,'login',$2)`, [user.id, req.ip]); } catch {}

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });
  const result = await db.query(
    `UPDATE users SET email_verified=true, verify_token=NULL WHERE verify_token=$1 RETURNING id`,
    [token]
  );
  if (!result.rows.length) return res.status(400).json({ error: 'Invalid token' });
  res.redirect(`${process.env.APP_URL}/?verified=1`);
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const result = await db.query(`SELECT id, name FROM users WHERE email=$1`, [email?.toLowerCase()]);
  if (result.rows.length) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000);
    await db.query(`UPDATE users SET reset_token=$1, reset_expires=$2 WHERE id=$3`, [token, expires, result.rows[0].id]);
    try { await sendPasswordReset(email, token); } catch {}
  }
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

module.exports = router;

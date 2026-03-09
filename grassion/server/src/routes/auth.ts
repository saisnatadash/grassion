import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import * as db from '../lib/db';
import { sendVerification, sendPasswordReset } from '../lib/mailer';

const router = Router();

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body as { email: string; password: string; name: string };
    if (!email || !password || !name) { res.status(400).json({ error: 'All fields required' }); return; }

    const hash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const result = await db.query(
      `INSERT INTO users(email, password_hash, name, verify_token)
       VALUES($1,$2,$3,$4) RETURNING id, email, name, plan`,
      [email.toLowerCase(), hash, name, verifyToken]
    );
    const user = result.rows[0];

    try { await sendVerification(email, name, verifyToken); } catch { /* email optional */ }

    const token = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    await db.query(
      `INSERT INTO audit_log(user_id, action, ip) VALUES($1,'register',$2)`,
      [user.id, req.ip]
    );

    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === '23505') { res.status(409).json({ error: 'Email already registered' }); return; }
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) { res.status(400).json({ error: 'Email and password required' }); return; }

    const result = await db.query(
      `SELECT id, email, name, password_hash, plan, subscription_status FROM users WHERE email=$1`,
      [email.toLowerCase()]
    );
    if (!result.rows.length) { res.status(401).json({ error: 'Invalid credentials' }); return; }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) { res.status(401).json({ error: 'Invalid credentials' }); return; }

    const token = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    await db.query(
      `INSERT INTO audit_log(user_id, action, ip) VALUES($1,'login',$2)`,
      [user.id, req.ip]
    );

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/verify', async (req: Request, res: Response) => {
  const { token } = req.query as { token: string };
  if (!token) { res.status(400).json({ error: 'Token required' }); return; }

  const result = await db.query(
    `UPDATE users SET email_verified=true, verify_token=NULL WHERE verify_token=$1 RETURNING id`,
    [token]
  );
  if (!result.rows.length) { res.status(400).json({ error: 'Invalid token' }); return; }

  res.redirect(`${process.env.APP_URL}/?verified=1`);
});

router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body as { email: string };
  const result = await db.query(`SELECT id, name FROM users WHERE email=$1`, [email?.toLowerCase()]);
  if (result.rows.length) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000);
    await db.query(`UPDATE users SET reset_token=$1, reset_expires=$2 WHERE id=$3`, [token, expires, result.rows[0].id]);
    try { await sendPasswordReset(email, token); } catch { /* ignore */ }
  }
  res.json({ ok: true, message: 'If that email exists, a reset link was sent.' });
});

router.post('/reset-password', async (req: Request, res: Response) => {
  const { token, password } = req.body as { token: string; password: string };
  if (!token || !password) { res.status(400).json({ error: 'Token and password required' }); return; }

  const result = await db.query(
    `SELECT id FROM users WHERE reset_token=$1 AND reset_expires > NOW()`,
    [token]
  );
  if (!result.rows.length) { res.status(400).json({ error: 'Invalid or expired token' }); return; }

  const hash = await bcrypt.hash(password, 12);
  await db.query(`UPDATE users SET password_hash=$1, reset_token=NULL, reset_expires=NULL WHERE id=$2`, [hash, result.rows[0].id]);
  res.json({ ok: true });
});

export default router;

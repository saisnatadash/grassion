const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../db');

const ADMIN_USERS = ['saisnatadash'];

router.get('/github', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    scope: 'repo,user:email',
    prompt: 'select_account'
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get('/github/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const tokenRes = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code
      },
      { headers: { Accept: 'application/json' } }
    );

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) {
      console.error('No access token:', tokenRes.data);
      return res.redirect('/?error=auth_failed');
    }

    const [userRes, emailRes] = await Promise.all([
      axios.get('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}` }
      }),
      axios.get('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${accessToken}` }
      }).catch(() => ({ data: [] }))
    ]);

    const ghUser = userRes.data;
    const primaryEmail = emailRes.data.find(e => e.primary)?.email || ghUser.email || '';

    // Upsert user - never overwrite plan/role
    await db.query(`
      INSERT INTO users (id, github_username, avatar_url, email, access_token, referral_code, last_seen, plan, role)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'free', 'user')
      ON CONFLICT (id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        avatar_url = EXCLUDED.avatar_url,
        email = CASE WHEN users.email = '' OR users.email IS NULL THEN EXCLUDED.email ELSE users.email END,
        last_seen = NOW()
    `, [
      ghUser.id, ghUser.login, ghUser.avatar_url, primaryEmail, accessToken,
      Math.random().toString(36).substring(2, 8).toUpperCase()
    ]);

    const dbResult = await db.query('SELECT * FROM users WHERE id = $1', [ghUser.id]);
    const dbUser = dbResult.rows[0] || {};

    const isAdmin = ADMIN_USERS.includes(ghUser.login);
    const plan = isAdmin ? 'pro' : (dbUser.plan || 'free');
    const role = isAdmin ? 'admin' : (dbUser.role || 'user');

    req.session.user = {
      id: ghUser.id,
      username: ghUser.login,
      avatar: ghUser.avatar_url,
      email: primaryEmail,
      accessToken,
      plan,
      role
    };

    req.session.save(() => {
      res.redirect('/dashboard');
    });

  } catch (err) {
    console.error('Auth callback error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

router.get('/me', async (req, res) => {
  if (!req.session.user) return res.json({ user: null });

  // Always apply admin bypass
  if (ADMIN_USERS.includes(req.session.user.username)) {
    req.session.user.plan = 'pro';
    req.session.user.role = 'admin';
  }

  try {
    const result = await db.query(
      `SELECT id, github_username, email, avatar_url, plan, role,
              scans_used, bonus_scans, referral_code, created_at
       FROM users WHERE id = $1`,
      [req.session.user.id]
    );

    if (!result.rows.length) {
      return res.json({ user: req.session.user });
    }

    const u = result.rows[0];
    const isAdmin = ADMIN_USERS.includes(u.github_username);
    const plan = isAdmin ? 'pro' : (u.plan || 'free');
    const role = isAdmin ? 'admin' : (u.role || 'user');

    req.session.user.plan = plan;
    req.session.user.role = role;

    return res.json({
      user: {
        id: u.id,
        username: u.github_username,
        email: u.email || '',
        avatar: u.avatar_url || '',
        plan,
        role,
        scans_used: u.scans_used || 0,
        bonus_scans: u.bonus_scans || 0,
        referral_code: u.referral_code || '',
        created_at: u.created_at,
        accessToken: req.session.user.accessToken
      }
    });
  } catch (err) {
    console.error('/me error:', err.message);
    return res.json({ user: req.session.user });
  }
});

module.exports = router;

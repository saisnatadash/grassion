const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../db');

// Founder accounts that always get pro+admin (bypass for testing)
const ADMIN_ACCOUNTS = ['saisnatadash'];

router.get('/github', (req, res) => {
  // prompt=select_account forces GitHub to show account chooser every time
  const url = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=repo,user:email&prompt=select_account`;
  res.redirect(url);
});

router.get('/github/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const tokenRes = await axios.post('https://github.com/login/oauth/access_token',
      { client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code },
      { headers: { Accept: 'application/json' } }
    );
    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw new Error('No access token received');

    const userRes = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const emailRes = await axios.get('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}` }
    }).catch(() => ({ data: [] }));

    const primaryEmail = emailRes.data.find(e => e.primary)?.email || '';
    const ghUser = userRes.data;

    // Upsert — NEVER overwrite plan/role on conflict
    await db.query(`
      INSERT INTO users (id, github_username, avatar_url, email, access_token, referral_code, last_seen, plan, role)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'free', 'user')
      ON CONFLICT (id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        avatar_url = EXCLUDED.avatar_url,
        last_seen = NOW()
    `, [ghUser.id, ghUser.login, ghUser.avatar_url, primaryEmail, accessToken,
        Math.random().toString(36).substring(2, 8).toUpperCase()
    ]);

    // Read fresh from DB
    const dbResult = await db.query('SELECT * FROM users WHERE id = $1', [ghUser.id]);
    const dbUser = dbResult.rows[0] || {};

    // Apply admin bypass
    const plan = ADMIN_ACCOUNTS.includes(ghUser.login) ? 'pro' : (dbUser.plan || 'free');
    const role = ADMIN_ACCOUNTS.includes(ghUser.login) ? 'admin' : (dbUser.role || 'user');

    req.session.user = {
      id: ghUser.id,
      username: ghUser.login,
      avatar: ghUser.avatar_url,
      email: primaryEmail,
      accessToken,
      plan,
      role
    };

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Auth error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Always reads fresh plan/role from DB
router.get('/me', async (req, res) => {
  if (!req.session.user) return res.json({ user: null });

  // Apply admin bypass for session
  if (ADMIN_ACCOUNTS.includes(req.session.user.username)) {
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
      // Not in DB yet — return session (bypass already applied)
      return res.json({
        user: {
          id: req.session.user.id,
          username: req.session.user.username,
          email: req.session.user.email || '',
          avatar: req.session.user.avatar || '',
          plan: req.session.user.plan,
          role: req.session.user.role,
          scans_used: 0,
          bonus_scans: 0,
          referral_code: 'SAI001',
          created_at: new Date(),
          accessToken: req.session.user.accessToken
        }
      });
    }

    const u = result.rows[0];
    const plan = ADMIN_ACCOUNTS.includes(u.github_username) ? 'pro' : (u.plan || 'free');
    const role = ADMIN_ACCOUNTS.includes(u.github_username) ? 'admin' : (u.role || 'user');

    // Update session
    req.session.user.plan = plan;
    req.session.user.role = role;

    res.json({
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
    // DB error — still return session (bypass applied)
    return res.json({
      user: {
        id: req.session.user.id,
        username: req.session.user.username,
        email: req.session.user.email || '',
        avatar: req.session.user.avatar || '',
        plan: req.session.user.plan,
        role: req.session.user.role,
        scans_used: 0,
        bonus_scans: 0,
        referral_code: '',
        created_at: new Date(),
        accessToken: req.session.user.accessToken
      }
    });
  }
});

module.exports = router;

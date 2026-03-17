const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../db');

router.get('/github', (req, res) => {
  const url = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=repo,user:email`;
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
    const userRes = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const emailRes = await axios.get('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const primaryEmail = emailRes.data.find(e => e.primary)?.email || '';
    const ghUser = userRes.data;

    await db.query(`
      INSERT INTO users (id, github_username, avatar_url, email, access_token, referral_code, last_seen)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (id) DO UPDATE SET
        access_token = $5, avatar_url = $3, last_seen = NOW()
    `, [ghUser.id, ghUser.login, ghUser.avatar_url, primaryEmail, accessToken,
        Math.random().toString(36).substring(2, 8).toUpperCase()]);

    req.session.user = {
      id: ghUser.id,
      username: ghUser.login,
      avatar: ghUser.avatar_url,
      email: primaryEmail,
      accessToken
    };
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Auth error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

module.exports = router;

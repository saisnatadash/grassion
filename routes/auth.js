const express = require('express');
const router  = express.Router();
const https   = require('https');
const db      = require('../db');

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u    = new URL(url);
    const req  = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Accept': 'application/json',
        'User-Agent': 'Grassion'
      }
    }, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => { try { resolve(JSON.parse(out)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data); req.end();
  });
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => { try { resolve(JSON.parse(out)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

router.get('/github', (req, res) => {
  if (req.query.intent) req.session.intent = req.query.intent;
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    scope: 'read:user user:email repo',
    redirect_uri: `${process.env.BASE_URL || 'https://grassion.com'}/auth/github/callback`
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get('/github/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/signin?error=github_denied');
  if (!code)  return res.redirect('/signin?error=no_code');

  try {
    const tokenData = await httpsPost('https://github.com/login/oauth/access_token', {
      client_id:     process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${process.env.BASE_URL || 'https://grassion.com'}/auth/github/callback`
    });

    if (tokenData.error) {
      console.error('[Auth] Token error:', tokenData.error);
      return res.redirect('/signin?error=' + tokenData.error);
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) return res.redirect('/signin?error=no_token');

    const headers = {
      Authorization: `token ${accessToken}`,
      'User-Agent': 'Grassion',
      Accept: 'application/json'
    };

    const profile = await httpsGet('https://api.github.com/user', headers);
    if (!profile.id) return res.redirect('/signin?error=profile_failed');

    let email = profile.email || null;
    try {
      const emails = await httpsGet('https://api.github.com/user/emails', headers);
      if (Array.isArray(emails)) {
        const primary = emails.find(e => e.primary && e.verified);
        email = (primary || emails[0] || {}).email || email;
      }
    } catch(e) {}

    const githubId  = String(profile.id);
    const username  = profile.login;
    const avatarUrl = profile.avatar_url || null;
    const refCode   = (username.substring(0, 4) + Math.random().toString(36).substring(2, 6)).toUpperCase();

    // UPSERT on github_id only — no delete, no github_username unique conflict
    const result = await db.query(`
      INSERT INTO users (
        github_id, github_username, email, avatar_url,
        access_token, github_access_token,
        referral_code, plan, role, created_at
      ) VALUES ($1,$2,$3,$4,$5,$5,$6,'free','user',NOW())
      ON CONFLICT (github_id) DO UPDATE SET
        github_username     = EXCLUDED.github_username,
        email               = COALESCE(EXCLUDED.email, users.email),
        avatar_url          = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
        access_token        = EXCLUDED.access_token,
        github_access_token = EXCLUDED.github_access_token,
        updated_at          = NOW()
      RETURNING
        id, github_username, email, plan, role,
        referral_code, bonus_scans, scans_used,
        onboarding_done, created_at
    `, [githubId, username, email, avatarUrl, accessToken, refCode]);

    const user = result.rows[0];
    if (!user) return res.redirect('/signin?error=db_error');

    console.log('[Auth] Login OK:', username, '| plan:', user.plan);

    req.session.user = {
      id:              user.id,
      username:        user.github_username,
      email:           user.email,
      plan:            user.plan || 'free',
      role:            user.role || 'user',
      referral_code:   user.referral_code || '',
      bonus_scans:     user.bonus_scans  || 0,
      scans_used:      user.scans_used   || 0,
      onboarding_done: user.onboarding_done || false,
      created_at:      user.created_at,
      accessToken
    };

    const intent = req.session.intent;
    delete req.session.intent;

    if (!user.onboarding_done) return res.redirect('/onboarding');
    if (intent === 'pro')      return res.redirect('/dashboard?upgrade=1');
    return res.redirect('/dashboard');

  } catch (err) {
    console.error('[Auth] Fatal:', err.message);
    return res.redirect('/signin?error=oauth_failed');
  }
});

router.get('/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ user: null });
  const { accessToken, ...safe } = req.session.user;
  res.json({ user: safe });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
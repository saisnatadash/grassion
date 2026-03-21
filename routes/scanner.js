const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { scanRepo, generateFix } = require('../services/scannerService');
const { createFixPR } = require('../services/githubService');
const { sendScanCompleteEmail, sendPRRaisedEmail } = require('../services/emailService');
const db = require('../db');

// Middleware to check scan limits
async function scanLimitMiddleware(req, res, next) {
  try {
    const result = await db.query(
      'SELECT plan, scans_used, bonus_scans FROM users WHERE id = $1',
      [req.session.user.id]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'User not found' });
    const user = result.rows[0];
    req.dbUser = user;

    // Pro users have unlimited scans
    if (user.plan === 'pro') return next();

    // Free users: 3 scans + bonus
    const totalAllowed = 3 + (user.bonus_scans || 0);
    if (user.scans_used >= totalAllowed) {
      return res.status(403).json({
        upgrade: true,
        error: 'Scan limit reached',
        scans_used: user.scans_used,
        total_allowed: totalAllowed,
        message: `You've used all ${totalAllowed} scans. Upgrade to Pro for unlimited scans.`
      });
    }
    next();
  } catch (err) {
    console.error('Plan check error:', err.message);
    next();
  }
}

router.post('/scan', authMiddleware, scanLimitMiddleware, async (req, res) => {
  const { owner, repo } = req.body;
  const user = req.session.user;
  try {
    const results = await scanRepo(user.accessToken, owner, repo);
    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);

    // Save scan to DB
    await db.query(
      `INSERT INTO scans (user_id, repo_name, total_issues, results, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [user.id, `${owner}/${repo}`, totalIssues, JSON.stringify(results)]
    );

    // Increment scan count
    await db.query('UPDATE users SET scans_used = scans_used + 1 WHERE id = $1', [user.id]);

    // Fetch updated counts to return to frontend
    const updatedUser = await db.query(
      'SELECT scans_used, bonus_scans, plan FROM users WHERE id = $1',
      [user.id]
    );
    const u = updatedUser.rows[0];
    const scansLeft = u.plan === 'pro' ? '∞' : Math.max(0, (3 + (u.bonus_scans || 0)) - u.scans_used);

    // Send email (non-blocking)
    const dbUser = await db.query('SELECT email FROM users WHERE id = $1', [user.id]);
    if (dbUser.rows[0]?.email) {
      sendScanCompleteEmail(
        dbUser.rows[0].email, user.username, `${owner}/${repo}`, totalIssues
      ).catch(e => console.error('Email error:', e.message));
    }

    res.json({
      success: true,
      results,
      totalIssues,
      scans_used: u.scans_used,
      scans_left: scansLeft
    });
  } catch (err) {
    console.error('Scan error:', err.message);
    res.status(500).json({ error: 'Scan failed. Please try again.' });
  }
});

router.post('/raise-pr', authMiddleware, async (req, res) => {
  const { owner, repo, results } = req.body;
  const user = req.session.user;

  // Check if user is pro for PR raising
  const dbCheck = await db.query('SELECT plan FROM users WHERE id = $1', [user.id]);
  if (dbCheck.rows[0]?.plan !== 'pro') {
    return res.status(403).json({
      upgrade: true,
      error: 'PR raising requires Pro plan'
    });
  }

  try {
    const fixedResults = [];
    for (const result of results) {
      const fixedCode = await generateFix(result.content, result.file, result.issues);
      fixedResults.push({ ...result, fixedCode });
    }
    const pr = await createFixPR(user.accessToken, owner, repo, fixedResults);

    await db.query(
      `UPDATE scans SET pr_url = $1, pr_raised = TRUE
       WHERE user_id = $2 AND repo_name = $3
       ORDER BY created_at DESC LIMIT 1`,
      [pr.html_url, user.id, `${owner}/${repo}`]
    );

    const dbUser = await db.query('SELECT email FROM users WHERE id = $1', [user.id]);
    if (dbUser.rows[0]?.email) {
      sendPRRaisedEmail(
        dbUser.rows[0].email, user.username, `${owner}/${repo}`, pr.html_url
      ).catch(e => console.error('Email error:', e.message));
    }

    res.json({ success: true, prUrl: pr.html_url });
  } catch (err) {
    console.error('PR error:', err.message);
    res.status(500).json({ error: 'Failed to raise PR. Please try again.' });
  }
});

router.get('/history', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM scans WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.session.user.id]
    );
    res.json({ scans: result.rows });
  } catch (err) {
    console.error('History error:', err.message);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Get current scan stats for dashboard
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT scans_used, bonus_scans, plan,
        (SELECT COUNT(*) FROM scans WHERE user_id = $1) as total_scans,
        (SELECT COALESCE(SUM(total_issues),0) FROM scans WHERE user_id = $1) as total_issues,
        (SELECT COUNT(*) FROM scans WHERE user_id = $1 AND pr_raised = TRUE) as prs_raised
       FROM users WHERE id = $1`,
      [req.session.user.id]
    );
    const u = result.rows[0] || {};
    res.json({
      scans_used: u.scans_used || 0,
      bonus_scans: u.bonus_scans || 0,
      plan: u.plan || 'free',
      total_scans: parseInt(u.total_scans) || 0,
      total_issues: parseInt(u.total_issues) || 0,
      prs_raised: parseInt(u.prs_raised) || 0,
      scans_left: u.plan === 'pro' ? null : Math.max(0, (3 + (u.bonus_scans || 0)) - (u.scans_used || 0))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;

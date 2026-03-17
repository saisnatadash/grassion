const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const planMiddleware = require('../middleware/plan');
const { scanRepo, generateFix } = require('../services/scannerService');
const { createFixPR } = require('../services/githubService');
const { sendScanCompleteEmail, sendPRRaisedEmail } = require('../services/emailService');
const db = require('../db');

router.post('/scan', authMiddleware, planMiddleware, async (req, res) => {
  const { owner, repo } = req.body;
  const user = req.session.user;
  try {
    const results = await scanRepo(user.accessToken, owner, repo);
    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
    await db.query(
      `INSERT INTO scans (user_id, repo_name, total_issues, results, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [user.id, `${owner}/${repo}`, totalIssues, JSON.stringify(results)]
    );
    await db.query('UPDATE users SET scans_used = scans_used + 1 WHERE id = $1', [user.id]);
    if (req.dbUser.email) {
      sendScanCompleteEmail(req.dbUser.email, user.username, `${owner}/${repo}`, totalIssues).catch(console.error);
    }
    res.json({ success: true, results, totalIssues });
  } catch (err) {
    console.error('Scan error:', err.message);
    res.status(500).json({ error: 'Scan failed' });
  }
});

router.post('/raise-pr', authMiddleware, async (req, res) => {
  const { owner, repo, results } = req.body;
  const user = req.session.user;
  try {
    const fixedResults = [];
    for (const result of results) {
      const fixedCode = await generateFix(result.content, result.file, result.issues);
      fixedResults.push({ ...result, fixedCode });
    }
    const pr = await createFixPR(user.accessToken, owner, repo, fixedResults);
    await db.query(
      'UPDATE scans SET pr_url = $1, pr_raised = TRUE WHERE user_id = $2 AND repo_name = $3 ORDER BY created_at DESC LIMIT 1',
      [pr.html_url, user.id, `${owner}/${repo}`]
    );
    const dbUser = await db.query('SELECT email FROM users WHERE id = $1', [user.id]);
    if (dbUser.rows[0]?.email) {
      sendPRRaisedEmail(dbUser.rows[0].email, user.username, `${owner}/${repo}`, pr.html_url).catch(console.error);
    }
    res.json({ success: true, prUrl: pr.html_url });
  } catch (err) {
    console.error('PR error:', err.message);
    res.status(500).json({ error: 'Failed to raise PR' });
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
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;

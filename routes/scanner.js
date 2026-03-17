const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { scanRepo, generateFix } = require('../services/scannerService');
const db = require('../db');

router.post('/scan', authMiddleware, async (req, res) => {
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

    res.json({ success: true, results, totalIssues });
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: 'Scan failed' });
  }
});

router.post('/fix', authMiddleware, async (req, res) => {
  const { owner, repo, filePath, issues, content } = req.body;
  const user = req.session.user;

  try {
    const { generateFix } = require('../services/scannerService');
    const fixedCode = await generateFix(content, filePath, issues);
    res.json({ success: true, fixedCode });
  } catch (err) {
    console.error('Fix error:', err);
    res.status(500).json({ error: 'Fix generation failed' });
  }
});

module.exports = router;
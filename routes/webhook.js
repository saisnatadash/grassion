const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { scanRepo, generateFix } = require('../services/scannerService');
const { createFixPR } = require('../services/githubService');

router.post('/github', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['x-hub-signature-256'];
  const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(req.body).digest('hex');
  if (sig !== digest) return res.status(401).json({ error: 'Invalid signature' });

  const event = req.headers['x-github-event'];
  const payload = JSON.parse(req.body);

  if (event === 'push') {
    const repoFullName = payload.repository.full_name;
    const [owner, repo] = repoFullName.split('/');
    try {
      const userResult = await db.query(
        `SELECT * FROM users WHERE github_username = $1 AND plan = 'pro'`,
        [payload.pusher.name]
      );
      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        const results = await scanRepo(user.access_token, owner, repo);
        if (results.length > 0) {
          const fixedResults = [];
          for (const r of results) {
            const fixedCode = await generateFix(r.content, r.file, r.issues);
            fixedResults.push({ ...r, fixedCode });
          }
          await createFixPR(user.access_token, owner, repo, fixedResults);
        }
      }
    } catch (err) {
      console.error('Webhook error:', err.message);
    }
  }
  res.json({ received: true });
});

module.exports = router;

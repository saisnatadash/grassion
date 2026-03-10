'use strict';
const { Router } = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.post('/webhook', async (req, res) => {
  try {
    const sig   = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'];
    if (!sig || !event) return res.status(400).send('Missing headers');

    const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
    const hmac = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(hmac))) return res.status(401).send('Signature mismatch');

    if (event !== 'pull_request') return res.json({ ok: true, skipped: true });

    const { action, pull_request: pr, repository } = req.body;
    if (!['opened','synchronize','reopened'].includes(action)) return res.json({ ok: true });

    const repoResult = await db.query(
      `SELECT r.id, r.user_id, u.plan FROM repos r JOIN users u ON u.id=r.user_id WHERE r.github_repo=$1 AND r.enabled=true LIMIT 1`,
      [repository.full_name]
    );
    if (!repoResult.rows.length) return res.json({ ok: true, message: 'Repo not tracked' });

    const repo = repoResult.rows[0];
    const added = pr.additions || 0, deleted = pr.deletions || 0, files = pr.changed_files || 0;
    let riskLevel = 'low', riskReason = 'Small, focused change';
    if (files > 20 || added > 500) { riskLevel = 'high'; riskReason = `Large PR: ${files} files, +${added}/-${deleted} lines`; }
    else if (files > 5 || added > 100) { riskLevel = 'medium'; riskReason = `Medium PR: ${files} files changed`; }

    const aiSummary = repo.plan === 'free' ? null
      : `PR #${pr.number}: "${pr.title}" — ${riskLevel} risk. ${riskReason}. ${added} additions, ${deleted} deletions across ${files} files.`;

    await db.query(
      `INSERT INTO pr_events(repo_id,user_id,pr_number,pr_title,pr_author,action,risk_level,risk_reason,ai_summary,blocked) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [repo.id, repo.user_id, pr.number, pr.title, pr.user?.login, action, riskLevel, riskReason, aiSummary, false]
    );
    await db.query(
      `INSERT INTO notifications(user_id,title,body,type) VALUES($1,$2,$3,'pr')`,
      [repo.user_id, `PR #${pr.number} ${action}`, `${pr.title} — ${riskLevel} risk`]
    );

    res.json({ ok: true, risk: riskLevel });
  } catch(e) {
    console.error('Webhook error', e);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

router.post('/repos', requireAuth, async (req, res) => {
  try {
    const { github_repo } = req.body;
    if (!github_repo) return res.status(400).json({ error: 'github_repo required' });
    const [owner, repo_name] = github_repo.split('/');
    if (!owner || !repo_name) return res.status(400).json({ error: 'Format: owner/repo' });
    const result = await db.query(
      `INSERT INTO repos(user_id,github_repo,owner,repo_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
      [req.user.id, github_repo, owner, repo_name]
    );
    res.status(201).json({ ok: true, id: result.rows[0]?.id });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to add repo' });
  }
});

router.get('/repos', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT id,github_repo,owner,repo_name,enabled,created_at FROM repos WHERE user_id=$1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

router.get('/events', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT pe.*, r.github_repo FROM pr_events pe JOIN repos r ON r.id=pe.repo_id WHERE pe.user_id=$1 ORDER BY pe.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json(result.rows);
});

module.exports = router;

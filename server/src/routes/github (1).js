'use strict';
const { Router } = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const router = Router();

// ── Real OpenAI PR summary ──────────────────────────────────────────────────
async function generateAISummary(pr, riskLevel, riskReason) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 150,
        messages: [
          {
            role: 'system',
            content: 'You are a senior code reviewer. Given a pull request, write a concise 2-3 sentence risk summary for the team. Be direct and actionable. Never use bullet points.'
          },
          {
            role: 'user',
            content: `PR #${pr.number}: "${pr.title}"
Description: ${pr.body ? pr.body.slice(0, 300) : 'No description provided'}
Stats: ${pr.changed_files} files changed, +${pr.additions} additions, -${pr.deletions} deletions
Author: ${pr.user?.login}
Risk level detected: ${riskLevel} — ${riskReason}

Write a 2-3 sentence summary of what this PR does and what reviewers should watch out for.`
          }
        ]
      })
    });
    const data = await response.json();
    if (data.choices && data.choices[0]) {
      return data.choices[0].message.content.trim();
    }
    return null;
  } catch (e) {
    console.error('OpenAI error:', e.message);
    return null;
  }
}

// ── GitHub Webhook ──────────────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  try {
    const sig   = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'];
    if (!sig || !event) return res.status(400).send('Missing headers');

    const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
    const hmac = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(hmac))) {
      return res.status(401).send('Signature mismatch');
    }

    if (event !== 'pull_request') return res.json({ ok: true, skipped: true });

    const { action, pull_request: pr, repository } = req.body;
    if (!['opened', 'synchronize', 'reopened'].includes(action)) {
      return res.json({ ok: true });
    }

    const repoResult = await db.query(
      `SELECT r.id, r.user_id, u.plan FROM repos r JOIN users u ON u.id=r.user_id WHERE r.github_repo=$1 AND r.enabled=true LIMIT 1`,
      [repository.full_name]
    );
    if (!repoResult.rows.length) return res.json({ ok: true, message: 'Repo not tracked' });

    const repo = repoResult.rows[0];
    const added = pr.additions || 0;
    const deleted = pr.deletions || 0;
    const files = pr.changed_files || 0;

    // Risk scoring
    let riskLevel = 'low';
    let riskReason = 'Small, focused change';
    if (files > 20 || added > 500) {
      riskLevel = 'high';
      riskReason = `Large PR: ${files} files, +${added}/-${deleted} lines`;
    } else if (files > 5 || added > 100) {
      riskLevel = 'medium';
      riskReason = `Medium PR: ${files} files changed`;
    }

    // AI summary — real OpenAI for paid plans, fallback for free
    let aiSummary = null;
    if (repo.plan !== 'free' && process.env.OPENAI_API_KEY) {
      aiSummary = await generateAISummary(pr, riskLevel, riskReason);
    }
    // Fallback if OpenAI fails or free plan
    if (!aiSummary) {
      aiSummary = `PR #${pr.number}: "${pr.title}" — ${riskLevel} risk. ${riskReason}. ${added} additions, ${deleted} deletions across ${files} files.`;
    }

    await db.query(
      `INSERT INTO pr_events(repo_id,user_id,pr_number,pr_title,pr_author,action,risk_level,risk_reason,ai_summary,blocked)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [repo.id, repo.user_id, pr.number, pr.title, pr.user?.login, action, riskLevel, riskReason, aiSummary, false]
    );

    await db.query(
      `INSERT INTO notifications(user_id,title,body,type) VALUES($1,$2,$3,'pr')`,
      [repo.user_id, `PR #${pr.number} ${action}`, `${pr.title} — ${riskLevel} risk`]
    );

    res.json({ ok: true, risk: riskLevel });
  } catch (e) {
    console.error('Webhook error', e);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ── Add repo ────────────────────────────────────────────────────────────────
router.post('/repos', requireAuth, async (req, res) => {
  try {
    const { github_repo } = req.body;
    if (!github_repo) return res.status(400).json({ error: 'github_repo required' });
    const [owner, repo_name] = github_repo.split('/');
    if (!owner || !repo_name) return res.status(400).json({ error: 'Format: owner/repo' });

    const result = await db.query(
      `INSERT INTO repos(user_id,github_repo,owner,repo_name)
       VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
      [req.user.id, github_repo, owner, repo_name]
    );
    res.status(201).json({ ok: true, id: result.rows[0]?.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to add repo' });
  }
});

// ── List repos ──────────────────────────────────────────────────────────────
router.get('/repos', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT id, github_repo, owner, repo_name, enabled, created_at
     FROM repos WHERE user_id=$1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

// ── Delete repo ─────────────────────────────────────────────────────────────
router.delete('/repos/:id', requireAuth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM repos WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete repo' });
  }
});

// ── PR Events ───────────────────────────────────────────────────────────────
router.get('/events', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT pe.*, r.github_repo FROM pr_events pe
     JOIN repos r ON r.id=pe.repo_id
     WHERE pe.user_id=$1 ORDER BY pe.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json(result.rows);
});

// ── Webhook secret (for settings page) ─────────────────────────────────────
router.get('/webhook-secret', requireAuth, async (_req, res) => {
  res.json({ secret: process.env.GITHUB_WEBHOOK_SECRET || '' });
});

module.exports = router;

'use strict';
const { Router } = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const router = Router();

// ── Real OpenAI PR summary ──
async function generateAISummary(pr, riskLevel, riskReason) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 150,
        messages: [
          { role: 'system', content: 'You are a senior code reviewer. Write a concise 2-3 sentence risk summary. Be direct and actionable. No bullet points.' },
          { role: 'user', content: `PR #${pr.number}: "${pr.title}"\nDescription: ${(pr.body||'No description').slice(0,300)}\nStats: ${pr.changed_files} files, +${pr.additions}/-${pr.deletions} lines\nAuthor: ${pr.user?.login}\nRisk level: ${riskLevel} — ${riskReason}\n\nWrite a 2-3 sentence risk summary.` }
        ]
      })
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch(e) { console.error('OpenAI error:', e.message); return null; }
}

// ── Post comment to GitHub PR ──
async function postGitHubComment(repo, prNumber, comment, githubToken) {
  if (!githubToken) return;
  try {
    const [owner, repoName] = repo.split('/');
    await fetch(`https://api.github.com/repos/${owner}/${repoName}/issues/${prNumber}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `token ${githubToken}`,
        'User-Agent': 'Grassion-Bot'
      },
      body: JSON.stringify({ body: comment })
    });
    console.log(`✓ Posted comment to ${repo}#${prNumber}`);
  } catch(e) { console.error('GitHub comment error:', e.message); }
}

// ── Format PR comment ──
function formatPRComment(pr, riskLevel, riskReason, aiSummary, blocked) {
  const emoji = blocked ? '⛔' : riskLevel === 'high' ? '⚠️' : riskLevel === 'medium' ? '🟡' : '✅';
  const status = blocked ? '**MERGE BLOCKED**' : riskLevel === 'high' ? '**High Risk — Review Required**' : riskLevel === 'medium' ? '**Medium Risk**' : '**Safe to Merge**';
  const riskScore = riskLevel === 'high' ? '85/100' : riskLevel === 'medium' ? '50/100' : '15/100';

  return `## ${emoji} Grassion Risk Analysis

${status}

| Metric | Value |
|--------|-------|
| Risk Level | \`${riskLevel.toUpperCase()}\` |
| Risk Score | ${riskScore} |
| Files Changed | ${pr.changed_files || 0} |
| Lines | +${pr.additions || 0} / -${pr.deletions || 0} |
| Blocked | ${blocked ? '⛔ Yes' : '✅ No'} |

**Risk Reason:** ${riskReason}

${aiSummary ? `**AI Analysis:**\n${aiSummary}` : ''}

---
*[Grassion](https://grassion.com) — Automated PR risk analysis*`;
}

// ── Send Slack alert ──
async function sendSlackIfConfigured(userId, prData, riskLevel, blocked, summary) {
  try {
    const result = await db.query('SELECT webhook_url, min_risk_level FROM slack_config WHERE user_id=$1', [userId]);
    if (!result.rows.length || !result.rows[0].webhook_url) return;
    const { webhook_url, min_risk_level } = result.rows[0];
    const levels = { low: 0, medium: 1, high: 2 };
    if (levels[riskLevel] < levels[min_risk_level || 'medium']) return;
    const { sendSlackAlert } = require('./slack');
    await sendSlackAlert(webhook_url, prData, riskLevel, blocked, summary);
  } catch(e) { /* slack_config table might not exist yet */ }
}

// ── Webhook ──
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
    if (!['opened', 'synchronize', 'reopened'].includes(action)) return res.json({ ok: true });

    const repoResult = await db.query(
      `SELECT r.id, r.user_id, u.plan FROM repos r JOIN users u ON u.id=r.user_id
       WHERE r.github_repo=$1 AND r.enabled=true LIMIT 1`,
      [repository.full_name]
    );
    if (!repoResult.rows.length) return res.json({ ok: true, message: 'Repo not tracked' });

    const repo = repoResult.rows[0];
    const added = pr.additions || 0, deleted = pr.deletions || 0, files = pr.changed_files || 0;

    // Risk scoring
    let riskLevel = 'low', riskReason = 'Small, focused change';
    if (files > 20 || added > 500) { riskLevel = 'high'; riskReason = `Large PR: ${files} files, +${added}/-${deleted} lines`; }
    else if (files > 5 || added > 100) { riskLevel = 'medium'; riskReason = `Medium PR: ${files} files changed`; }

    // AI summary for paid plans
    let aiSummary = null;
    if (repo.plan !== 'free') {
      aiSummary = await generateAISummary(pr, riskLevel, riskReason);
    }
    if (!aiSummary) {
      aiSummary = `PR #${pr.number}: "${pr.title}" — ${riskLevel} risk. ${riskReason}. ${added} additions, ${deleted} deletions across ${files} files.`;
    }

    const blocked = riskLevel === 'high';

    // Save to DB
    await db.query(
      `INSERT INTO pr_events(repo_id,user_id,pr_number,pr_title,pr_author,action,risk_level,risk_reason,ai_summary,blocked)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [repo.id, repo.user_id, pr.number, pr.title, pr.user?.login, action, riskLevel, riskReason, aiSummary, blocked]
    );

    // Save notification
    await db.query(
      `INSERT INTO notifications(user_id,title,body,type) VALUES($1,$2,$3,'pr')`,
      [repo.user_id, `PR #${pr.number} ${action}`, `${pr.title} — ${riskLevel} risk`]
    );

    // Post comment back to GitHub PR
    const comment = formatPRComment(pr, riskLevel, riskReason, aiSummary, blocked);
    await postGitHubComment(repository.full_name, pr.number, comment, process.env.GITHUB_TOKEN);

    // Send Slack alert
    await sendSlackIfConfigured(repo.user_id, {
      pr_number: pr.number, pr_title: pr.title,
      github_repo: repository.full_name, pr_author: pr.user?.login,
      action, risk_reason: riskReason
    }, riskLevel, blocked, aiSummary);

    res.json({ ok: true, risk: riskLevel, blocked, comment_posted: !!process.env.GITHUB_TOKEN });
  } catch(e) {
    console.error('Webhook error', e);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ── Add repo ──
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
    res.status(201).json({
      ok: true,
      id: result.rows[0]?.id,
      webhook_url: `${process.env.APP_URL || 'https://grassion.com'}/api/github/webhook`,
      webhook_secret: process.env.GITHUB_WEBHOOK_SECRET || '',
      instructions: 'Go to GitHub repo → Settings → Webhooks → Add webhook. Use the webhook_url and webhook_secret above. Set Content-Type to application/json. Select Pull requests event.'
    });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to add repo' });
  }
});

// ── List repos ──
router.get('/repos', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT id, github_repo, owner, repo_name, enabled, created_at FROM repos WHERE user_id=$1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

// ── Delete repo ──
router.delete('/repos/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM repos WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Failed to delete repo' }); }
});

// ── PR Events ──
router.get('/events', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT pe.*, r.github_repo FROM pr_events pe
     JOIN repos r ON r.id=pe.repo_id
     WHERE pe.user_id=$1 ORDER BY pe.created_at DESC LIMIT 100`,
    [req.user.id]
  );
  res.json(result.rows);
});

// ── Webhook secret for settings page ──
router.get('/webhook-secret', requireAuth, async (_req, res) => {
  res.json({ secret: process.env.GITHUB_WEBHOOK_SECRET || '' });
});

module.exports = router;

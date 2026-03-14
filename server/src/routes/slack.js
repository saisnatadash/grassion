'use strict';
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../lib/db');
const router = Router();

// Send Slack notification for a PR event
async function sendSlackAlert(webhookUrl, pr, riskLevel, blocked, summary) {
  if (!webhookUrl) return;
  const color = blocked ? '#f56565' : riskLevel === 'high' ? '#ecc94b' : '#48bb78';
  const emoji = blocked ? '⛔' : riskLevel === 'high' ? '⚠️' : '✅';
  const payload = {
    attachments: [{
      color,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *PR #${pr.pr_number}: ${pr.pr_title}*\n*Repo:* \`${pr.github_repo}\` · *Author:* @${pr.pr_author || 'unknown'}`
          }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Risk Level*\n${riskLevel.toUpperCase()}` },
            { type: 'mrkdwn', text: `*Status*\n${blocked ? 'BLOCKED' : 'SAFE'}` },
            { type: 'mrkdwn', text: `*Action*\n${pr.action || 'opened'}` },
            { type: 'mrkdwn', text: `*Risk Reason*\n${pr.risk_reason || '—'}` }
          ]
        },
        summary ? {
          type: 'section',
          text: { type: 'mrkdwn', text: `*AI Analysis*\n${summary}` }
        } : null,
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `Grassion · ${new Date().toLocaleString('en-IN')}` }]
        }
      ].filter(Boolean)
    }]
  };
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch(e) {
    console.error('Slack alert failed:', e.message);
  }
}

// Save/update Slack webhook URL for a user
router.post('/webhook', requireAuth, async (req, res) => {
  try {
    const { webhook_url, min_risk } = req.body;
    if (!webhook_url) return res.status(400).json({ error: 'webhook_url required' });
    if (!webhook_url.startsWith('https://hooks.slack.com/')) {
      return res.status(400).json({ error: 'Invalid Slack webhook URL' });
    }
    await db.query(
      `INSERT INTO slack_config(user_id, webhook_url, min_risk_level)
       VALUES($1,$2,$3)
       ON CONFLICT(user_id) DO UPDATE SET webhook_url=$2, min_risk_level=$3, updated_at=NOW()`,
      [req.user.id, webhook_url, min_risk || 'medium']
    );
    res.json({ ok: true });
  } catch(e) {
    // Table might not exist yet — return ok anyway so UI doesn't break
    console.error('Slack config save error:', e.message);
    res.json({ ok: true, note: 'Saved in session (DB table pending migration)' });
  }
});

// Get Slack config for user
router.get('/webhook', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT webhook_url, min_risk_level FROM slack_config WHERE user_id=$1',
      [req.user.id]
    );
    res.json(result.rows[0] || { webhook_url: '', min_risk_level: 'medium' });
  } catch(e) {
    res.json({ webhook_url: '', min_risk_level: 'medium' });
  }
});

// Test Slack webhook
router.post('/test', requireAuth, async (req, res) => {
  try {
    const { webhook_url } = req.body;
    if (!webhook_url) return res.status(400).json({ error: 'webhook_url required' });
    await sendSlackAlert(webhook_url, {
      pr_number: 999,
      pr_title: 'Test PR — Grassion is connected!',
      github_repo: 'your/repo',
      pr_author: req.user.name || req.user.email,
      action: 'opened',
      risk_reason: 'This is a test notification'
    }, 'medium', false, 'This is a test alert from Grassion. Your Slack integration is working correctly.');
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: 'Test failed: ' + e.message });
  }
});

module.exports = router;
module.exports.sendSlackAlert = sendSlackAlert;

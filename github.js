'use strict';
const express  = require('express');
const { Octokit } = require('@octokit/rest');
const crypto   = require('crypto');
const db       = require('../lib/db');
const authMw   = require('../middleware/auth');

const router = express.Router();

// ── RISKY PATTERNS LIBRARY ───────────────────────────────────────────────────
const PATTERNS = [
  { re: /RETRY/i,        label: 'retry configuration',    risk: 'high',     category: 'resilience' },
  { re: /TIMEOUT/i,      label: 'timeout setting',         risk: 'high',     category: 'resilience' },
  { re: /POOL_SIZE/i,    label: 'connection pool size',    risk: 'high',     category: 'database'   },
  { re: /MAX_CONN/i,     label: 'max connections',         risk: 'high',     category: 'database'   },
  { re: /CACHE_TTL/i,    label: 'cache TTL',               risk: 'high',     category: 'cache'      },
  { re: /CACHE_SIZE/i,   label: 'cache size',              risk: 'medium',   category: 'cache'      },
  { re: /RATE_LIMIT/i,   label: 'rate limit',              risk: 'medium',   category: 'throttle'   },
  { re: /WORKER/i,       label: 'worker configuration',    risk: 'medium',   category: 'concurrency'},
  { re: /CONCURRENCY/i,  label: 'concurrency setting',     risk: 'medium',   category: 'concurrency'},
  { re: /QUEUE/i,        label: 'queue setting',           risk: 'medium',   category: 'messaging'  },
  { re: /BATCH_SIZE/i,   label: 'batch size',              risk: 'medium',   category: 'processing' },
  { re: /THRESHOLD/i,    label: 'threshold value',         risk: 'medium',   category: 'monitoring' },
  { re: /FEATURE_/i,     label: 'feature flag',            risk: 'medium',   category: 'flags'      },
  { re: /MAX_MEMORY/i,   label: 'memory limit',            risk: 'high',     category: 'resources'  },
  { re: /HEAP/i,         label: 'heap configuration',      risk: 'high',     category: 'resources'  },
  { re: /DATABASE_URL/i, label: 'database connection',     risk: 'critical', category: 'secrets'    },
  { re: /SECRET/i,       label: 'secret value',            risk: 'critical', category: 'secrets'    },
  { re: /API_KEY/i,      label: 'API key',                 risk: 'critical', category: 'secrets'    },
  { re: /AUTH_/i,        label: 'auth configuration',      risk: 'high',     category: 'auth'       },
  { re: /MAX_PAYLOAD/i,  label: 'payload size limit',      risk: 'medium',   category: 'api'        },
  { re: /REPLICA/i,      label: 'replication setting',     risk: 'high',     category: 'database'   },
  { re: /SHARD/i,        label: 'sharding configuration',  risk: 'high',     category: 'database'   },
];

// ── EXTRACT CHANGED KEYS FROM DIFF PATCH ─────────────────────────────────────
function extractKeys(patch) {
  if (!patch) return [];
  const keys = new Set();
  for (const line of patch.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const m = line.match(/[+\s]*([A-Z_][A-Z0-9_]{2,})\s*[=:]/);
    if (m && m[1].length >= 3) keys.add(m[1]);
  }
  return [...keys];
}

// ── EXTRACT BEFORE/AFTER VALUES ───────────────────────────────────────────────
function extractChange(patch, key) {
  if (!patch) return { from: null, to: null };
  let from = null, to = null;
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re  = new RegExp(`^[\\+\\-].*${esc}\\s*[=:]\\s*(.+)$`);
  for (const line of patch.split('\n')) {
    const m = line.match(re);
    if (m) {
      const val = m[1].trim().replace(/['"]/g, '');
      if (line.startsWith('-')) from = val;
      if (line.startsWith('+')) to   = val;
    }
  }
  return { from, to };
}

// ── ANALYSE KEYS AGAINST PATTERNS ────────────────────────────────────────────
function analyse(keys) {
  const hits = [];
  for (const key of keys) {
    for (const p of PATTERNS) {
      if (p.re.test(key)) { hits.push({ key, ...p }); break; }
    }
  }
  return hits;
}

// ── SEARCH PR HISTORY ─────────────────────────────────────────────────────────
async function searchPRHistory(octokit, owner, repo, key) {
  try {
    const r = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:merged ${key} in:body`,
      sort: 'updated', per_page: 3,
    });
    return r.data.items.map(i => ({ number: i.number, title: i.title, url: i.html_url, closedAt: i.closed_at }));
  } catch { return []; }
}

// ── BUILD FREE COMMENT ────────────────────────────────────────────────────────
function buildFreeComment(hits, pastPRs) {
  const lines = ['### ⚠️ Grassion Guardrail', ''];
  lines.push('This PR changes configuration with a history of causing production issues.', '');
  for (const h of hits) {
    lines.push(`**\`${h.key}\`** — ${h.label} *(${h.risk} risk)*`);
    const prs = pastPRs[h.key] || [];
    if (prs.length) lines.push(`→ Previously changed in [PR #${prs[0].number}](${prs[0].url}): *${prs[0].title}*`);
    lines.push('');
  }
  lines.push('---');
  lines.push('*[Grassion](https://grassion.com) — PR Guardrail · [Upgrade to Pro](https://grassion.com#features) for full incident trace with AI reasoning*');
  return lines.join('\n');
}

// ── BUILD PRO COMMENT ─────────────────────────────────────────────────────────
function buildProComment(hits, pastPRs, incidents) {
  const lines = ['### 🛡️ Grassion Guardrail — Incident Trace (Pro)', ''];
  for (const h of hits) {
    const emoji = h.risk === 'critical' ? '🔴' : h.risk === 'high' ? '🟠' : '🟡';
    lines.push(`${emoji} **\`${h.key}\`** — ${h.label} · **${h.risk.toUpperCase()} RISK**`, '');

    const related = incidents.filter(i => (i.config_keys || []).includes(h.key));
    if (related.length) {
      const inc = related[0];
      lines.push(`> **📋 Incident on record: ${inc.title}**`);
      lines.push(`> Severity: **${inc.severity}** · Occurred: ${inc.occurred_at ? new Date(inc.occurred_at).toLocaleDateString('en-IN') : 'Unknown'}`);
      if (inc.downtime_mins) lines.push(`> Downtime: **${inc.downtime_mins} minutes**`);
      if (inc.root_cause)    lines.push(`> Root cause: ${inc.root_cause.slice(0, 200)}`);
      if (inc.resolution)    lines.push(`> Resolution: ${inc.resolution.slice(0, 200)}`);
      if (inc.pr_url)        lines.push(`> Reverting PR: [view](${ inc.pr_url})`);
      if (inc.runbook_url)   lines.push(`> Runbook: [view](${inc.runbook_url})`);
      lines.push('');
    }

    const prs = pastPRs[h.key] || [];
    if (prs.length && !related.length) {
      lines.push(`> Previously changed in [PR #${prs[0].number}](${prs[0].url}): *${prs[0].title}*`, '');
    }
  }
  lines.push('---');
  lines.push('*[Grassion Pro](https://grassion.com) · AI incident trace enabled · [Dashboard](https://grassion.com/dashboard.html)*');
  return lines.join('\n');
}

// ── VERIFY WEBHOOK SIGNATURE ─────────────────────────────────────────────────
function verifySignature(body, sig) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  return sig === expected;
}

// ── WEBHOOK ──────────────────────────────────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig   = req.headers['x-hub-signature-256'];
  if (!verifySignature(req.body, sig)) return res.status(401).send('Bad signature');

  const event   = req.headers['x-github-event'];
  let payload;
  try { payload = JSON.parse(req.body); } catch { return res.status(400).send('Bad JSON'); }

  res.status(200).send('OK');

  if (event === 'pull_request' && ['opened', 'synchronize'].includes(payload.action)) {
    processPR(payload).catch(e => console.error('PR handler error:', e.message));
  }
});

async function processPR(payload) {
  const { pull_request: pr, repository: repo, installation } = payload;
  if (!installation?.id) return;

  // Find user by installation
  const userRes = await db.query(
    'SELECT * FROM users WHERE github_installation_id=$1', [installation.id.toString()]
  );
  const user = userRes.rows[0];
  const plan = user?.plan || 'free';

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  // Get changed files
  let files = [];
  try {
    const fr = await octokit.rest.pulls.listFiles({
      owner: repo.owner.login, repo: repo.name,
      pull_number: pr.number, per_page: 100,
    });
    files = fr.data;
  } catch (e) { console.error('listFiles failed:', e.message); return; }

  // Extract all changed keys
  const allKeys = [];
  const patchMap = {};
  for (const f of files) {
    const keys = extractKeys(f.patch || '');
    for (const k of keys) patchMap[k] = f.patch;
    allKeys.push(...keys);
  }

  if (!allKeys.length) return;

  const hits = analyse(allKeys);
  if (!hits.length) return;

  // Enrich hits with before/after values
  for (const h of hits) {
    if (patchMap[h.key]) {
      const { from, to } = extractChange(patchMap[h.key], h.key);
      h.from = from; h.to = to;
    }
  }

  // Search PR history for each hit
  const pastPRs = {};
  for (const h of hits) {
    pastPRs[h.key] = await searchPRHistory(octokit, repo.owner.login, repo.name, h.key);
  }

  // Pro: load incidents from DB
  let incidents = [];
  if (plan !== 'free') {
    try {
      const repoRow = await db.query('SELECT id FROM repositories WHERE full_name=$1', [repo.full_name]);
      if (repoRow.rows.length) {
        const ir = await db.query(
          'SELECT * FROM incident_history WHERE repo_id=$1 ORDER BY occurred_at DESC LIMIT 30',
          [repoRow.rows[0].id]
        );
        incidents = ir.rows;
      }
    } catch {}
  }

  // Build & post comment
  const body = plan === 'free'
    ? buildFreeComment(hits, pastPRs)
    : buildProComment(hits, pastPRs, incidents);

  let commentId = null, commentUrl = null;
  try {
    const cr = await octokit.rest.issues.createComment({
      owner: repo.owner.login, repo: repo.name,
      issue_number: pr.number, body,
    });
    commentId  = cr.data.id;
    commentUrl = cr.data.html_url;

    // Block merge on critical if enabled (Pro only)
    if (plan !== 'free' && hits.some(h => h.risk === 'critical')) {
      const repoRow = await db.query('SELECT block_on_critical FROM repositories WHERE full_name=$1', [repo.full_name]);
      if (repoRow.rows[0]?.block_on_critical) {
        await octokit.rest.repos.createCommitStatus({
          owner: repo.owner.login, repo: repo.name,
          sha: pr.head.sha,
          state: 'failure',
          description: 'Grassion: Critical config pattern detected — review required',
          context: 'grassion/guardrail',
        }).catch(() => {});
      }
    }
  } catch (e) { console.error('Comment failed:', e.message); return; }

  // Log to DB
  await logEvent(repo, pr, hits, commentId, commentUrl, plan, user?.id);
}

async function logEvent(repo, pr, hits, commentId, commentUrl, plan, userId) {
  // Upsert repo
  let repoId;
  try {
    const r = await db.query(
      `INSERT INTO repositories (user_id, github_repo_id, full_name, owner, name)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (github_repo_id) DO UPDATE
         SET full_name=EXCLUDED.full_name, guardrail_count=repositories.guardrail_count+1, last_scan_at=NOW()
       RETURNING id`,
      [userId, repo.id, repo.full_name, repo.owner.login, repo.name]
    );
    repoId = r.rows[0].id;
  } catch (e) { console.error('Repo upsert failed:', e.message); return; }

  for (const h of hits) {
    await db.query(
      `INSERT INTO guardrail_events
       (repo_id,pr_number,pr_title,pr_author,pr_url,triggered_key,changed_from,changed_to,risk_level,comment_id,comment_url,plan_tier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [repoId, pr.number, pr.title, pr.user.login, pr.html_url,
       h.key, h.from || null, h.to || null, h.risk, commentId, commentUrl, plan]
    ).catch(() => {});
  }

  if (userId) {
    await db.query(
      `INSERT INTO audit_log (user_id,repo_id,event_type,event_data) VALUES ($1,$2,'guardrail_fired',$3)`,
      [userId, repoId, JSON.stringify({ pr: pr.number, keys: hits.map(h => h.key) })]
    ).catch(() => {});
  }
}

// ── DASHBOARD APIS ────────────────────────────────────────────────────────────
router.get('/events', authMw, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT ge.*, rep.full_name AS repo_name, rep.owner AS repo_owner
       FROM guardrail_events ge
       JOIN repositories rep ON ge.repo_id = rep.id
       WHERE rep.user_id=$1
       ORDER BY ge.created_at DESC LIMIT 100`,
      [req.userId]
    );
    res.json(r.rows);
  } catch { res.status(500).json({ error: 'Failed' }); }
});

router.get('/repos', authMw, async (req, res) => {
  try {
    const r = await db.query(
      'SELECT * FROM repositories WHERE user_id=$1 ORDER BY last_scan_at DESC NULLS LAST, created_at DESC',
      [req.userId]
    );
    res.json(r.rows);
  } catch { res.status(500).json({ error: 'Failed' }); }
});

// INCIDENTS (Pro)
router.post('/incidents', authMw, async (req, res) => {
  const planRes = await db.query('SELECT plan FROM users WHERE id=$1', [req.userId]);
  if (planRes.rows[0]?.plan === 'free')
    return res.status(403).json({ error: 'Incident history requires Pro plan' });

  const { repoId, title, description, rootCause, resolution,
          configKeys, severity, downtimeMins, occurredAt, prUrl, runbookUrl } = req.body;
  try {
    const r = await db.query(
      `INSERT INTO incident_history
       (repo_id,user_id,title,description,root_cause,resolution,config_keys,severity,downtime_mins,occurred_at,pr_url,runbook_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [repoId, req.userId, title, description, rootCause, resolution,
       configKeys, severity || 'P2', downtimeMins, occurredAt, prUrl, runbookUrl]
    );
    res.json({ id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/incidents', authMw, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT ih.*, rep.full_name AS repo_name
       FROM incident_history ih
       LEFT JOIN repositories rep ON ih.repo_id = rep.id
       WHERE ih.user_id=$1
       ORDER BY ih.occurred_at DESC`,
      [req.userId]
    );
    res.json(r.rows);
  } catch { res.status(500).json({ error: 'Failed' }); }
});

router.get('/stats', authMw, async (req, res) => {
  try {
    const byRisk = await db.query(
      `SELECT ge.risk_level, COUNT(*)::int AS count
       FROM guardrail_events ge JOIN repositories r ON ge.repo_id=r.id
       WHERE r.user_id=$1 AND ge.created_at > NOW()-INTERVAL '30 days'
       GROUP BY ge.risk_level`, [req.userId]
    );
    const total = await db.query(
      `SELECT COUNT(*)::int AS n FROM guardrail_events ge
       JOIN repositories r ON ge.repo_id=r.id WHERE r.user_id=$1`, [req.userId]
    );
    const repos = await db.query(
      `SELECT COUNT(*)::int AS n FROM repositories WHERE user_id=$1`, [req.userId]
    );
    res.json({ byRisk: byRisk.rows, total: total.rows[0].n, repoCount: repos.rows[0].n });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;

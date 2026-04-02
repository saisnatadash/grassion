// routes/webhook.js — Grassion PR Guardrail Engine v2.0
// FIXES:
//   1. access_token aliased correctly as github_token in JOIN query
//   2. events INSERT: ON CONFLICT DO NOTHING removed (no unique constraint exists)
//      replaced with plain INSERT — duplicate PR events are acceptable log entries

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Octokit } = require('@octokit/rest');
const OpenAI = require('openai');

const db = require('../db');
function getDb(req) { return db; }

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.startsWith('sk-proj-your') || key.length < 20) return null;
  return new OpenAI({ apiKey: key });
}

// ── VERIFY GITHUB SIGNATURE ──
function verifySignature(req, secret) {
  if (!secret) return true;
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(req.body));
  const digest = 'sha256=' + hmac.digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest)); }
  catch (e) { return false; }
}

// ── MAIN WEBHOOK ENDPOINT ──
router.post('/github', async (req, res) => {
  const event = req.headers['x-github-event'];
  const db = getDb(req);

  res.status(200).json({ received: true });

  if (event !== 'pull_request') return;

  const payload = req.body;
  const action = payload.action;

  if (!['opened', 'synchronize', 'reopened'].includes(action)) return;

  const pr = payload.pull_request;
  const repo = payload.repository;
  const owner = repo.owner.login;
  const repoName = repo.name;
  const prNumber = pr.number;
  const prTitle = pr.title;
  const baseBranch = pr.base.ref;
  const headBranch = pr.head.ref;
  const authorLogin = pr.user.login;

  console.log(`[Guardrail] PR #${prNumber} ${action} on ${owner}/${repoName} by @${authorLogin}`);

  try {
    // FIX: access_token column aliased as github_token — was causing server error
    // u.username removed (column doesn't exist) — use u.github_username
    const repoResult = await db.query(
      `SELECT wr.*, u.access_token AS github_token, u.plan, u.id AS user_id, u.github_username AS username
       FROM webhook_repos wr
       JOIN users u ON u.id = wr.user_id
       WHERE wr.repo_full_name = $1 AND wr.active = true`,
      [`${owner}/${repoName}`]
    );

    if (!repoResult.rows.length) {
      console.log(`[Guardrail] No registered user for ${owner}/${repoName}`);
      return;
    }

    const repoConfig = repoResult.rows[0];
    const { github_token, plan, user_id, username } = repoConfig;

    if (!github_token) {
      console.log(`[Guardrail] No GitHub token for user ${username}`);
      return;
    }

    const octokit = new Octokit({ auth: github_token });

    try {
      await octokit.checks.create({
        owner, repo: repoName,
        name: 'Grassion Security Guard',
        head_sha: pr.head.sha,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        output: {
          title: '🛡️ Grassion is analyzing this PR...',
          summary: 'Scanning diff for security vulnerabilities, auth gaps, and risky patterns.'
        }
      });
    } catch (e) { /* checks API needs GitHub App — fallback to review comments */ }

    const { data: files } = await octokit.pulls.listFiles({
      owner, repo: repoName, pull_number: prNumber, per_page: 50
    });

    const scanableFiles = files.filter(f => {
      const ext = f.filename.split('.').pop().toLowerCase();
      return ['js', 'ts', 'py', 'go', 'java', 'php', 'rb', 'cs', 'jsx', 'tsx'].includes(ext)
        && f.status !== 'removed'
        && f.additions > 0;
    });

    if (!scanableFiles.length) {
      console.log(`[Guardrail] No scannable files in PR #${prNumber}`);
      await octokit.pulls.createReview({
        owner, repo: repoName, pull_number: prNumber,
        commit_id: pr.head.sha,
        event: 'APPROVE',
        body: '✅ **Grassion Security Guard** — No code changes detected requiring security review. Safe to merge.'
      });
      return;
    }

    let diffContext = '';
    const filePatches = [];
    for (const f of scanableFiles.slice(0, 12)) {
      const patch = f.patch || '';
      diffContext += `\n\n=== FILE: ${f.filename} (${f.additions} additions, ${f.deletions} deletions) ===\n${patch.substring(0, 3000)}`;
      filePatches.push({ filename: f.filename, patch, sha: f.sha });
    }

    let fileContext = '';
    for (const f of scanableFiles.slice(0, 4)) {
      try {
        const { data } = await octokit.repos.getContent({
          owner, repo: repoName, path: f.filename, ref: pr.head.sha
        });
        if (data.encoding === 'base64') {
          const content = Buffer.from(data.content, 'base64').toString('utf8');
          if (content.length < 5000) {
            fileContext += `\n\n=== FULL FILE: ${f.filename} ===\n${content}`;
          }
        }
      } catch (e) { /* skip */ }
    }

    const openai = getOpenAI();
    let analysis = null;

    if (openai) {
      try {
        const systemPrompt = `You are Grassion, an expert security engineer reviewing a GitHub Pull Request diff.
Your job: find real security vulnerabilities introduced by this PR's changes. Be precise. No false positives.

Focus on these categories (in order of severity):
1. CRITICAL: Auth bypass, missing authentication middleware, JWT tampering, privilege escalation
2. HIGH: SQL injection, command injection, path traversal, SSRF, exposed secrets/API keys
3. HIGH: Insecure direct object references (IDOR), mass assignment vulnerabilities
4. MEDIUM: Missing input validation on user-controlled data, XSS vectors
5. MEDIUM: Sensitive data in logs, error messages exposing internals
6. LOW: Hardcoded credentials, insecure crypto, weak session config

Respond ONLY with a JSON object:
{
  "risk_score": 0-100,
  "risk_level": "SAFE|LOW|MEDIUM|HIGH|CRITICAL",
  "verdict": "APPROVE|REQUEST_CHANGES|BLOCK",
  "summary": "1-2 sentence plain English summary of what this PR does security-wise",
  "issues": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "category": "category name",
      "file": "path/to/file.js",
      "line": 42,
      "code_snippet": "exact line of bad code",
      "title": "Short title",
      "explanation": "Plain English: what's wrong and why it's dangerous",
      "fix": "Exact code fix or specific instruction",
      "cwe": "CWE-XXX"
    }
  ],
  "positive_findings": ["Good security practice found, if any"],
  "merge_recommendation": "One sentence: safe to merge / needs fixes before merging"
}

If no real security issues found, return risk_score 0-15, verdict APPROVE, empty issues array.
Never invent issues. Only flag real vulnerabilities in the actual diff.`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `PR: "${prTitle}" by @${authorLogin}\nBase: ${baseBranch} ← Head: ${headBranch}\n\nDIFF:\n${diffContext}\n\nFULL FILE CONTEXT:\n${fileContext}` }
          ],
          max_tokens: 3000,
          temperature: 0.1,
          response_format: { type: 'json_object' }
        });

        analysis = JSON.parse(completion.choices[0].message.content);
      } catch (e) {
        console.error('[Guardrail] OpenAI error:', e.message);
        analysis = ruleBasedScan(scanableFiles, fileContext + diffContext);
      }
    } else {
      analysis = ruleBasedScan(scanableFiles, fileContext + diffContext);
    }

    if (!analysis) {
      console.log('[Guardrail] Analysis failed');
      return;
    }

    const reviewComments = [];

    for (const issue of (analysis.issues || []).slice(0, 10)) {
      if (!issue.file || !issue.line) continue;
      const fileData = filePatches.find(f => f.filename === issue.file);
      if (!fileData?.patch) continue;
      const position = getDiffPosition(fileData.patch, issue.line);
      if (position === null) continue;

      const severityEmoji = { CRITICAL: '🚨', HIGH: '🔴', MEDIUM: '🟡', LOW: '🔵' }[issue.severity] || '🔵';
      const body = `${severityEmoji} **${issue.severity}: ${issue.title}**\n\n${issue.explanation}\n\n` +
        `**What to fix:**\n\`\`\`\n${issue.fix}\n\`\`\`\n\n` +
        `*${issue.cwe || ''} · Detected by [Grassion](https://grassion.com)*`;

      reviewComments.push({ path: issue.file, position, body });
    }

    const riskEmoji = { SAFE: '✅', LOW: '🟢', MEDIUM: '🟡', HIGH: '🔴', CRITICAL: '🚨' }[analysis.risk_level] || '🟡';
    const verdictText = {
      APPROVE: '✅ **Safe to merge** — no significant security issues found.',
      REQUEST_CHANGES: '⚠️ **Changes requested** — security issues must be addressed before merging.',
      BLOCK: '🚨 **BLOCKED** — critical security vulnerabilities detected. Do not merge until resolved.'
    }[analysis.verdict] || '';

    let reviewBody = `## ${riskEmoji} Grassion Security Review — Risk: ${analysis.risk_level} (${analysis.risk_score}/100)\n\n`;
    reviewBody += `${verdictText}\n\n`;
    reviewBody += `**Summary:** ${analysis.summary}\n\n`;

    if (analysis.issues?.length) {
      reviewBody += `### Issues Found (${analysis.issues.length})\n\n`;
      for (const issue of analysis.issues) {
        const sev = { CRITICAL: '🚨', HIGH: '🔴', MEDIUM: '🟡', LOW: '🔵' }[issue.severity] || '🔵';
        reviewBody += `- ${sev} **${issue.severity}** in \`${issue.file}\`: ${issue.title}\n`;
      }
      reviewBody += '\n*See inline comments above for exact fixes.*\n\n';
    } else {
      reviewBody += '### No security issues detected in this diff. 🎉\n\n';
    }

    if (analysis.positive_findings?.length) {
      reviewBody += `### Good Practices Spotted ✓\n${analysis.positive_findings.map(p => `- ${p}`).join('\n')}\n\n`;
    }

    reviewBody += `---\n*${analysis.merge_recommendation}*\n\n`;
    reviewBody += `*[View on Grassion Dashboard](https://grassion.com/dashboard) · [Docs](https://grassion.com/about)*`;

    const githubVerdict = analysis.verdict === 'APPROVE' ? 'APPROVE' : 'REQUEST_CHANGES';

    await octokit.pulls.createReview({
      owner, repo: repoName, pull_number: prNumber,
      commit_id: pr.head.sha,
      event: githubVerdict,
      body: reviewBody,
      comments: reviewComments.slice(0, 8)
    });

    // ── SAVE TO DB ──
    try {
      await db.query(
        `INSERT INTO scans (user_id, repo_name, branch, issues_found, status, scan_type, risk_level, created_at)
         VALUES ($1, $2, $3, $4, 'completed', 'pr_guard', $5, NOW())`,
        [user_id, `${owner}/${repoName}`, headBranch, analysis.issues?.length || 0, analysis.risk_level]
      );

      // FIX: Removed ON CONFLICT DO NOTHING — events table has no unique constraint.
      // Duplicate PR scan events are fine as an audit log.
      await db.query(
        `INSERT INTO events (user_id, type, repo_name, metadata, created_at)
         VALUES ($1, 'pr_scan', $2, $3, NOW())`,
        [user_id, `${owner}/${repoName}`, JSON.stringify({
          pr_number: prNumber,
          pr_title: prTitle,
          author: authorLogin,
          risk_level: analysis.risk_level,
          risk_score: analysis.risk_score,
          issues_count: analysis.issues?.length || 0,
          verdict: analysis.verdict
        })]
      );
    } catch (e) {
      console.error('[Guardrail] DB save error:', e.message);
    }

    console.log(`[Guardrail] ✓ PR #${prNumber} reviewed. Risk: ${analysis.risk_level}, Issues: ${analysis.issues?.length || 0}, Verdict: ${analysis.verdict}`);

  } catch (e) {
    console.error('[Guardrail] Fatal error:', e.message, e.stack);
  }
});

// ── RULE-BASED SCANNER (fallback when no OpenAI key) ──
function ruleBasedScan(files, content) {
  const issues = [];

  const rules = [
    {
      test: () => /process\.env\.[A-Z_]+\s*=\s*['"][^'"]{8,}['"]/i.test(content),
      severity: 'HIGH', category: 'Hardcoded Secret',
      title: 'Potential hardcoded credential or secret',
      explanation: 'A secret or API key appears to be hardcoded in the code.',
      fix: 'Move to environment variables: process.env.YOUR_SECRET',
      cwe: 'CWE-798'
    },
    {
      test: () => /password\s*[:=]\s*['"][^'"]{3,}['"]/i.test(content) && !/placeholder|example|test|hash|bcrypt/i.test(content),
      severity: 'CRITICAL', category: 'Hardcoded Password',
      title: 'Hardcoded password detected',
      explanation: 'A plaintext password is hardcoded in the source.',
      fix: 'Remove immediately. Use environment variables and proper secrets management.',
      cwe: 'CWE-259'
    },
    {
      test: () => /db\.query\s*\([^)]*\+\s*(req\.|params\.|body\.|query\.)/i.test(content),
      severity: 'CRITICAL', category: 'SQL Injection',
      title: 'Potential SQL injection via string concatenation',
      explanation: 'User input appears concatenated directly into a SQL query.',
      fix: 'Use parameterized queries: db.query("SELECT * FROM users WHERE id = $1", [req.params.id])',
      cwe: 'CWE-89'
    },
    {
      test: () => /exec\s*\(.*req\.|spawn\s*\(.*req\.|eval\s*\(.*req\./i.test(content),
      severity: 'CRITICAL', category: 'Command Injection',
      title: 'User input passed to exec/spawn/eval',
      explanation: 'Unvalidated user input reaching command execution.',
      fix: 'Never pass user input to exec/spawn. Use allowlists and sanitize all inputs.',
      cwe: 'CWE-78'
    },
    {
      test: () => /jwt\.sign\s*\([^)]*,\s*['"]{2}/i.test(content),
      severity: 'CRITICAL', category: 'Insecure JWT',
      title: 'JWT signed with empty secret',
      explanation: 'JWT tokens signed with an empty string can be trivially forged.',
      fix: 'Use a strong random secret: jwt.sign(payload, process.env.JWT_SECRET)',
      cwe: 'CWE-347'
    },
    {
      test: () => /console\.log\s*\(.*password|console\.log\s*\(.*token|console\.log\s*\(.*secret/i.test(content),
      severity: 'MEDIUM', category: 'Sensitive Data Logging',
      title: 'Password/token/secret logged to console',
      explanation: 'Logging sensitive data exposes credentials in server logs.',
      fix: 'Remove logging of passwords, tokens, and secrets.',
      cwe: 'CWE-532'
    },
    {
      test: () => /cors\s*\(\s*\{\s*origin\s*:\s*['"]\*['"]/i.test(content),
      severity: 'MEDIUM', category: 'Insecure CORS',
      title: 'CORS configured to allow all origins (*)',
      explanation: 'Wildcard CORS allows any website to make credentialed requests.',
      fix: 'Specify exact allowed origins: cors({ origin: ["https://yourdomain.com"] })',
      cwe: 'CWE-346'
    }
  ];

  for (const rule of rules) {
    if (rule.test()) {
      issues.push({
        severity: rule.severity,
        category: rule.category,
        file: files[0]?.filename || 'unknown',
        line: 1,
        title: rule.title,
        explanation: rule.explanation,
        fix: rule.fix,
        cwe: rule.cwe
      });
    }
  }

  const riskScore = Math.min(100, issues.reduce((sum, i) => {
    return sum + ({ CRITICAL: 40, HIGH: 25, MEDIUM: 10, LOW: 5 }[i.severity] || 0);
  }, 0));

  const riskLevel = riskScore >= 60 ? 'CRITICAL' : riskScore >= 35 ? 'HIGH' : riskScore >= 15 ? 'MEDIUM' : riskScore > 0 ? 'LOW' : 'SAFE';
  const verdict = riskScore >= 60 ? 'BLOCK' : riskScore >= 35 ? 'REQUEST_CHANGES' : 'APPROVE';

  return {
    risk_score: riskScore,
    risk_level: riskLevel,
    verdict,
    summary: issues.length
      ? `Found ${issues.length} security issue${issues.length > 1 ? 's' : ''} in this PR.`
      : 'No security issues detected in the changed files.',
    issues,
    positive_findings: [],
    merge_recommendation: verdict === 'APPROVE' ? 'Safe to merge.' : 'Address security issues before merging.'
  };
}

// ── GET DIFF POSITION ──
function getDiffPosition(patch, lineNumber) {
  if (!patch) return null;
  const lines = patch.split('\n');
  let currentLine = 0;
  let position = 0;

  for (const line of lines) {
    position++;
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      if (match) currentLine = parseInt(match[1]) - 1;
      continue;
    }
    if (!line.startsWith('-')) currentLine++;
    if (currentLine === lineNumber) return position;
    if (currentLine > lineNumber + 5) break;
  }
  return position > 0 ? Math.min(position, lines.length) : null;
}

// ── REGISTER WEBHOOK ON REPO ──
router.post('/register', async (req, res) => {
  const { repo_full_name } = req.body;
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!repo_full_name) return res.status(400).json({ error: 'repo_full_name required' });

  const db = getDb(req);
  const userId = req.session.user.id;
  const [owner, repo] = repo_full_name.split('/');

  try {
    // FIX: alias access_token as github_token
    const userResult = await db.query('SELECT access_token AS github_token, plan FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user?.github_token) return res.status(400).json({ error: 'GitHub token required. Reconnect GitHub.' });

    const octokit = new Octokit({ auth: user.github_token });
    const webhookUrl = `${process.env.APP_URL || 'https://grassion.com'}/webhook/github`;
    let hookId = null;

    try {
      const { data: hooks } = await octokit.repos.listWebhooks({ owner, repo });
      const existing = hooks.find(h => h.config?.url === webhookUrl);

      if (existing) {
        hookId = existing.id;
        await octokit.repos.updateWebhook({
          owner, repo, hook_id: hookId,
          active: true,
          events: ['pull_request']
        });
      } else {
        const { data: hook } = await octokit.repos.createWebhook({
          owner, repo,
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret: process.env.WEBHOOK_SECRET || 'grassion_webhook_secret',
            insecure_ssl: '0'
          },
          events: ['pull_request'],
          active: true
        });
        hookId = hook.id;
      }
    } catch (e) {
      if (e.status === 403) return res.status(403).json({ error: 'No admin access to this repository.' });
      throw e;
    }

    await db.query(
      `INSERT INTO webhook_repos (user_id, repo_full_name, hook_id, active, created_at)
       VALUES ($1, $2, $3, true, NOW())
       ON CONFLICT (user_id, repo_full_name) DO UPDATE SET hook_id = $3, active = true`,
      [userId, repo_full_name, hookId]
    );

    res.json({ success: true, hook_id: hookId, message: `PR Guardrail active on ${repo_full_name}` });

  } catch (e) {
    console.error('[Webhook Register]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── UNREGISTER WEBHOOK ──
router.post('/unregister', async (req, res) => {
  const { repo_full_name } = req.body;
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });

  const db = getDb(req);
  const userId = req.session.user.id;
  const [owner, repo] = (repo_full_name || '').split('/');

  try {
    const result = await db.query(
      'SELECT hook_id FROM webhook_repos WHERE user_id = $1 AND repo_full_name = $2',
      [userId, repo_full_name]
    );

    if (result.rows.length && result.rows[0].hook_id) {
      // FIX: alias access_token as github_token
      const userResult = await db.query('SELECT access_token AS github_token FROM users WHERE id = $1', [userId]);
      const token = userResult.rows[0]?.github_token;
      if (token) {
        const octokit = new Octokit({ auth: token });
        try {
          await octokit.repos.deleteWebhook({ owner, repo, hook_id: result.rows[0].hook_id });
        } catch (e) { /* hook may already be gone */ }
      }
    }

    await db.query(
      'UPDATE webhook_repos SET active = false WHERE user_id = $1 AND repo_full_name = $2',
      [userId, repo_full_name]
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── LIST PROTECTED REPOS ──
router.get('/repos', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  const db = getDb(req);
  try {
    const result = await db.query(
      `SELECT wr.repo_full_name, wr.active, wr.created_at,
              COUNT(s.id) as scan_count,
              MAX(s.created_at) as last_scan,
              SUM(s.issues_found) as total_issues
       FROM webhook_repos wr
       LEFT JOIN scans s ON s.repo_name = wr.repo_full_name AND s.scan_type = 'pr_guard'
       WHERE wr.user_id = $1
       GROUP BY wr.repo_full_name, wr.active, wr.created_at
       ORDER BY wr.created_at DESC`,
      [req.session.user.id]
    );
    res.json({ repos: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── RECENT PR EVENTS ──
router.get('/events', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  const db = getDb(req);
  try {
    const result = await db.query(
      `SELECT * FROM events WHERE user_id = $1 AND type = 'pr_scan' ORDER BY created_at DESC LIMIT 30`,
      [req.session.user.id]
    );
    res.json({ events: result.rows });
  } catch (e) {
    res.json({ events: [] });
  }
});

module.exports = router;
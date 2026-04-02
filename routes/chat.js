// routes/chat.js — Grassion Code Guardian v2.2
// FIXES:
//   1. getToken() reads accessToken OR access_token from session (both covered)
//   2. chat_sessions queries wrapped with try/catch — if table missing, returns empty gracefully
//   3. analyze: OpenAI errors return 503 with clear message instead of crashing
//   4. apply: raise-pr uses token from getToken(req), not undefined accessToken variable

const express = require('express');
const router = express.Router();
const { Octokit } = require('@octokit/rest');
const db = require('../db');

function authMiddleware(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// FIX: reads both possible session key names
function getToken(req) {
  return req.session?.user?.accessToken || req.session?.user?.access_token || null;
}

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.length < 20) return null;
  try { const OpenAI = require('openai'); return new OpenAI({ apiKey: key }); }
  catch (e) { return null; }
}

// ── BRANCHES ──
router.get('/branches', authMiddleware, async (req, res) => {
  const { owner, repo } = req.query;
  const token = getToken(req);
  if (!token || !owner || !repo) return res.json({ branches: ['main', 'master'] });
  try {
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.repos.listBranches({ owner, repo, per_page: 30 });
    res.json({ branches: data.map(b => b.name) });
  } catch (e) { res.json({ branches: ['main', 'master'] }); }
});

// ── FILE TREE ──
router.get('/tree', authMiddleware, async (req, res) => {
  const { owner, repo, branch = 'main' } = req.query;
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Session expired. Please sign out and reconnect GitHub.' });
  if (!owner || !repo) return res.json({ tree: [] });
  try {
    const octokit = new Octokit({ auth: token });
    let treeData;
    try {
      const { data } = await octokit.git.getTree({ owner, repo, tree_sha: branch, recursive: '1' });
      treeData = data;
    } catch (e) {
      const { data: rd } = await octokit.repos.get({ owner, repo });
      const { data } = await octokit.git.getTree({ owner, repo, tree_sha: rd.default_branch, recursive: '1' });
      treeData = data;
    }
    const files = treeData.tree
      .filter(f => f.type === 'blob' && !f.path.includes('node_modules') && !f.path.includes('dist/') && f.path.match(/\.(js|ts|py|go|rb|java|php|cs|jsx|tsx)$/))
      .map(f => ({ path: f.path, sha: f.sha, size: f.size })).slice(0, 200);
    res.json({ tree: files });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── LIST SESSIONS ──
router.get('/sessions', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, repo_name, prompt, risk_level, files_changed, pr_url, created_at FROM chat_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.session.user.id]
    );
    res.json({ sessions: result.rows });
  } catch (e) {
    // FIX: if chat_sessions table doesn't exist yet, return empty instead of 500
    console.error('[Chat] Sessions query error:', e.message);
    res.json({ sessions: [] });
  }
});

// ── GET SINGLE SESSION ──
router.get('/session/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ session: result.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ANALYZE ──
router.post('/analyze', authMiddleware, async (req, res) => {
  const { prompt, repo, branch = 'main', session_id, context_files = [] } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  if (!repo)   return res.status(400).json({ error: 'repo required' });

  const userId = req.session.user.id;
  const token  = getToken(req);

  // Check plan
  let userPlan = 'free';
  try {
    const ur = await db.query('SELECT plan FROM users WHERE id = $1', [userId]);
    userPlan = ur.rows[0]?.plan || 'free';
  } catch (e) {}

  if (userPlan !== 'pro' && !session_id) {
    try {
      const existing = await db.query('SELECT COUNT(*) FROM chat_sessions WHERE user_id = $1', [userId]);
      if (parseInt(existing.rows[0].count) >= 1) {
        return res.status(403).json({ error: 'Free trial used. Upgrade to Pro for unlimited Code Guardian.', upgrade: true });
      }
    } catch (e) { /* table may not exist yet — allow through */ }
  }

  // FIX: check OpenAI key upfront and return clear 503 — not a crash
  const openai = getOpenAI();
  if (!openai) {
    return res.status(503).json({ error: 'OpenAI key not configured. Add OPENAI_API_KEY in Railway variables.' });
  }

  // Read repo files
  let fileContents = '';
  if (token) {
    try {
      const octokit = new Octokit({ auth: token });
      const [owner, repoName] = repo.split('/');
      const filesToRead = context_files.length > 0
        ? context_files.slice(0, 8)
        : await getKeyFiles(octokit, owner, repoName, branch);

      for (const fp of filesToRead) {
        try {
          const { data } = await octokit.repos.getContent({ owner, repo: repoName, path: fp, ref: branch });
          if (data.encoding === 'base64') {
            const content = Buffer.from(data.content, 'base64').toString('utf8');
            if (content.length < 8000) fileContents += `\n\n--- FILE: ${fp} ---\n${content}`;
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // Load conversation history
  let conversationHistory = [];
  if (session_id) {
    try {
      const sr = await db.query(
        'SELECT conversation_history FROM chat_sessions WHERE id = $1 AND user_id = $2',
        [session_id, userId]
      );
      if (sr.rows.length) conversationHistory = sr.rows[0].conversation_history || [];
    } catch (e) {}
  }

  const systemPrompt = `You are Code Guardian by Grassion. Analyze GitHub repositories and generate precise code changes.
Repository: ${repo} (branch: ${branch})
${fileContents ? `Code:\n${fileContents.substring(0, 12000)}` : ''}
Respond ONLY with valid JSON:
{"summary":"what you will change","understanding":"your interpretation","risk_level":"LOW|MEDIUM|HIGH","risk_reason":"why","changes":[{"path":"file.js","description":"what","original":"exact original code verbatim","new_content":"replacement","reason":"why","is_new_file":false}],"tests_to_run":["npm test"],"pr_title":"fix: title","pr_description":"description"}
For clarification: {"needs_clarification":true,"questions":["q1"],"summary":"what you need"}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-6),
        { role: 'user', content: prompt }
      ],
      max_tokens: 4000,
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    let analysis;
    try {
      analysis = JSON.parse(completion.choices[0].message.content);
    } catch (e) {
      analysis = { summary: completion.choices[0].message.content, changes: [], risk_level: 'LOW' };
    }

    if (analysis.changes) {
      analysis.changes = analysis.changes.map(c => ({
        path:        c.path || c.file || 'unknown',
        description: c.description || '',
        original:    c.original || c.original_content || '',
        new_content: c.new_content || c.new || '',
        reason:      c.reason || '',
        is_new_file: c.is_new_file || false
      }));
    }

    conversationHistory.push({ role: 'user', content: prompt });
    conversationHistory.push({ role: 'assistant', content: completion.choices[0].message.content });

    let newSessionId = session_id;
    try {
      if (session_id) {
        await db.query(
          'UPDATE chat_sessions SET conversation_history=$1, risk_level=$2, files_changed=$3 WHERE id=$4',
          [JSON.stringify(conversationHistory), analysis.risk_level || 'LOW', (analysis.changes || []).length, session_id]
        );
      } else {
        const ins = await db.query(
          `INSERT INTO chat_sessions (user_id, repo_name, prompt, conversation_history, risk_level, files_changed, pr_branch, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           RETURNING id`,
          [userId, repo, prompt, JSON.stringify(conversationHistory), analysis.risk_level || 'LOW', (analysis.changes || []).length, branch]
        );
        newSessionId = ins.rows[0].id;
      }
    } catch (e) {
      console.error('[Chat] Session save error:', e.message);
      // Don't fail the response — session persistence is non-critical
    }

    res.json({ ...analysis, session_id: newSessionId, repo, branch });

  } catch (e) {
    console.error('[Chat] OpenAI error:', e.message);
    // FIX: return 503 with message — not a raw 500 crash
    res.status(503).json({ error: 'Code Guardian temporarily unavailable: ' + e.message });
  }
});

// ── APPLY / RAISE PR ──
router.post('/apply', authMiddleware, async (req, res) => {
  const { session_id, changes, pr_title, pr_description } = req.body;
  if (!changes?.length) return res.status(400).json({ error: 'No changes to apply' });

  const userId = req.session.user.id;
  // FIX: was referencing undefined `accessToken` variable — now uses getToken(req)
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'No GitHub token. Please reconnect GitHub.' });

  // Plan check
  try {
    const ur = await db.query('SELECT plan FROM users WHERE id = $1', [userId]);
    if (ur.rows[0]?.plan !== 'pro') {
      return res.status(403).json({ error: 'Raising PRs requires Pro plan.', upgrade: true });
    }
  } catch (e) {}

  try {
    const sr = await db.query(
      'SELECT repo_name, pr_branch FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [session_id, userId]
    );
    if (!sr.rows.length) return res.status(404).json({ error: 'Session not found' });

    const { repo_name, pr_branch } = sr.rows[0];
    const [owner, repo] = repo_name.split('/');
    const octokit = new Octokit({ auth: token });
    const baseBranch = pr_branch || 'main';

    // Get base SHA
    let baseSha;
    try {
      const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${baseBranch}` });
      baseSha = refData.object.sha;
    } catch (e) {
      const { data: rd } = await octokit.repos.get({ owner, repo });
      const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${rd.default_branch}` });
      baseSha = refData.object.sha;
    }

    const newBranch = `grassion/fix-${Date.now()}`;
    await octokit.git.createRef({ owner, repo, ref: `refs/heads/${newBranch}`, sha: baseSha });

    const filesChanged = [];
    for (const change of changes) {
      const fp = change.path || change.file;
      if (!fp) continue;
      try {
        let sha;
        try {
          const { data: ex } = await octokit.repos.getContent({ owner, repo, path: fp, ref: newBranch });
          sha = ex.sha;
        } catch (e) {}

        await octokit.repos.createOrUpdateFileContents({
          owner, repo, path: fp,
          message: `fix: ${change.description || 'Grassion AI fix'}`,
          content: Buffer.from(change.new_content || '').toString('base64'),
          branch: newBranch,
          ...(sha ? { sha } : {})
        });
        filesChanged.push(fp);
      } catch (e) {
        console.error('[Chat] Commit error:', fp, e.message);
      }
    }

    if (!filesChanged.length) return res.status(500).json({ error: 'No files were committed successfully.' });

    const { data: pr } = await octokit.pulls.create({
      owner, repo,
      title: pr_title || 'AI security fixes [Grassion]',
      body: pr_description || `Files changed:\n${filesChanged.map(f => `- \`${f}\``).join('\n')}`,
      head: newBranch,
      base: baseBranch
    });

    try {
      await db.query(
        'UPDATE chat_sessions SET pr_url = $1, pr_branch = $2 WHERE id = $3',
        [pr.html_url, newBranch, session_id]
      );
    } catch (e) {}

    res.json({
      success: true,
      pr_url: pr.html_url,
      pr_number: pr.number,
      branch: newBranch,
      files_changed: filesChanged
    });

  } catch (e) {
    console.error('[Chat] Apply error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── HELPER: Pick key files from repo ──
async function getKeyFiles(octokit, owner, repo, branch) {
  try {
    const { data } = await octokit.git.getTree({ owner, repo, tree_sha: branch, recursive: '1' });
    const priority = ['server.js', 'app.js', 'index.js'];
    const files = data.tree
      .filter(f => f.type === 'blob' && f.path.match(/\.(js|ts|py|go|rb)$/) && !f.path.includes('node_modules'))
      .map(f => f.path);
    return [...priority.filter(p => files.includes(p)), ...files.filter(p => !priority.includes(p))].slice(0, 6);
  } catch (e) { return []; }
}

module.exports = router;
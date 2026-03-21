const express = require('express');
const router = express.Router();
const axios = require('axios');
const OpenAI = require('openai');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

// Pro-only middleware
async function proOnly(req, res, next) {
  const result = await db.query('SELECT plan FROM users WHERE id = $1', [req.session.user.id]);
  if (result.rows[0]?.plan !== 'pro') {
    return res.status(403).json({ error: 'This feature requires a Pro plan.' });
  }
  req.dbUser = result.rows[0];
  next();
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Fetch file contents from GitHub
async function getRepoFiles(accessToken, owner, repo, branch = 'main') {
  try {
    // Get repo tree
    const treeRes = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const files = treeRes.data.tree.filter(f =>
      f.type === 'blob' &&
      (f.path.endsWith('.js') || f.path.endsWith('.ts') || f.path.endsWith('.py')) &&
      !f.path.includes('node_modules') &&
      !f.path.includes('.min.') &&
      f.size < 50000
    ).slice(0, 20); // Limit to 20 files to stay within token budget

    const contents = [];
    for (const file of files) {
      try {
        const contentRes = await axios.get(
          `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const decoded = Buffer.from(contentRes.data.content, 'base64').toString('utf-8');
        contents.push({ path: file.path, content: decoded.substring(0, 3000) }); // Limit each file
      } catch(e) {}
    }
    return contents;
  } catch(e) {
    console.error('Repo fetch error:', e.message);
    return [];
  }
}

// Create or update a file on GitHub
async function updateFileOnGitHub(accessToken, owner, repo, filePath, newContent, branch, message) {
  try {
    // Get current file SHA
    let sha = null;
    try {
      const existing = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      sha = existing.data.sha;
    } catch(e) {}

    const body = {
      message,
      content: Buffer.from(newContent).toString('base64'),
      branch
    };
    if (sha) body.sha = sha;

    await axios.put(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
      body,
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
    return true;
  } catch(e) {
    console.error('GitHub update error:', e.message);
    return false;
  }
}

// Generate unified diff
function generateDiff(original, modified, filename) {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const diff = [`--- a/${filename}`, `+++ b/${filename}`];

  // Simple line-by-line diff
  const maxLen = Math.max(origLines.length, modLines.length);
  let i = 0, j = 0;
  while (i < origLines.length || j < modLines.length) {
    if (i < origLines.length && j < modLines.length && origLines[i] === modLines[j]) {
      diff.push(` ${origLines[i]}`);
      i++; j++;
    } else {
      if (i < origLines.length) diff.push(`-${origLines[i++]}`);
      if (j < modLines.length) diff.push(`+${modLines[j++]}`);
    }
    if (diff.length > 200) { diff.push('... (truncated)'); break; }
  }
  return diff.join('\n');
}

// Analyze repo and generate changes
router.post('/analyze', authMiddleware, proOnly, async (req, res) => {
  const { prompt, repo, branch = 'main' } = req.body;
  if (!prompt || !repo) return res.status(400).json({ error: 'Prompt and repo required' });

  const [owner, repoName] = repo.split('/');
  const accessToken = req.session.user.accessToken;

  try {
    // Fetch repo files
    const files = await getRepoFiles(accessToken, owner, repoName, branch);
    if (!files.length) {
      return res.json({
        summary: "I couldn't access the repository files. Make sure the repo exists and you have access.",
        changes: [],
        session_id: null
      });
    }

    // Build context for OpenAI
    const fileContext = files.map(f => `=== ${f.path} ===\n${f.content}`).join('\n\n');
    const systemPrompt = `You are Grassion, an AI code assistant. You analyze codebases and make precise, targeted code changes.

When given a task, you:
1. Analyze the relevant files
2. Generate the COMPLETE modified file content for each file that needs changing
3. Explain what you changed and why

Respond in this exact JSON format:
{
  "summary": "Brief explanation of what you're doing and why",
  "changes": [
    {
      "file": "path/to/file.js",
      "original_content": "the exact current content of the file",
      "modified_content": "the complete modified file content",
      "description": "what was changed in this file"
    }
  ]
}

Only modify files that actually need changing. Be precise and minimal. Do not break existing functionality.`;

    const userMessage = `Repository: ${repo}\nBranch: ${branch}\n\nTask: ${prompt}\n\nRepository files:\n${fileContext.substring(0, 60000)}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);

    // Generate diffs for each change
    const changesWithDiff = (aiResponse.changes || []).map(ch => ({
      file: ch.file,
      original_content: ch.original_content,
      modified_content: ch.modified_content,
      description: ch.description,
      diff: generateDiff(ch.original_content || '', ch.modified_content || '', ch.file)
    }));

    // Save session to DB for later PR raising
    let sessionId = null;
    try {
      const sessionResult = await db.query(
        `INSERT INTO chat_sessions (user_id, repo, branch, prompt, summary, changes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id`,
        [req.session.user.id, repo, branch, prompt, aiResponse.summary, JSON.stringify(changesWithDiff)]
      );
      sessionId = sessionResult.rows[0].id;
    } catch(e) {
      // chat_sessions table may not exist yet - create it
      await db.query(`
        CREATE TABLE IF NOT EXISTS chat_sessions (
          id SERIAL PRIMARY KEY,
          user_id BIGINT,
          repo TEXT,
          branch TEXT DEFAULT 'main',
          prompt TEXT,
          summary TEXT,
          changes JSONB,
          pr_url TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `).catch(() => {});
      const sessionResult = await db.query(
        `INSERT INTO chat_sessions (user_id, repo, branch, prompt, summary, changes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id`,
        [req.session.user.id, repo, branch, prompt, aiResponse.summary, JSON.stringify(changesWithDiff)]
      ).catch(() => ({ rows: [{ id: null }] }));
      sessionId = sessionResult.rows[0]?.id;
    }

    res.json({
      success: true,
      summary: aiResponse.summary,
      changes: changesWithDiff,
      session_id: sessionId
    });

  } catch(e) {
    console.error('Chat analyze error:', e.message);
    if (e.message.includes('JSON')) {
      return res.json({ summary: 'I analyzed the repo but had trouble formatting the response. Please try rephrasing your request.', changes: [], session_id: null });
    }
    res.status(500).json({ error: 'Failed to analyze repository. Please try again.' });
  }
});

// Raise PR with approved changes
router.post('/raise-pr', authMiddleware, proOnly, async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'Session ID required' });

  try {
    const sessionResult = await db.query(
      'SELECT * FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [session_id, req.session.user.id]
    );
    if (!sessionResult.rows.length) return res.status(404).json({ error: 'Session not found' });

    const session = sessionResult.rows[0];
    const changes = typeof session.changes === 'string' ? JSON.parse(session.changes) : session.changes;
    const [owner, repo] = session.repo.split('/');
    const branch = session.branch || 'main';
    const accessToken = req.session.user.accessToken;

    // Create a new branch for the changes
    const prBranch = `grassion/ai-fix-${Date.now()}`;

    // Get base branch SHA
    const baseRes = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const baseSha = baseRes.data.object.sha;

    // Create new branch
    await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      { ref: `refs/heads/${prBranch}`, sha: baseSha },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    // Apply all file changes to the new branch
    for (const change of changes) {
      await updateFileOnGitHub(
        accessToken, owner, repo, change.file,
        change.modified_content, prBranch,
        `fix: ${change.description || 'AI suggested fix'}`
      );
    }

    // Create pull request
    const prRes = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        title: `[Grassion AI] ${session.prompt.substring(0, 60)}`,
        body: `## AI-suggested changes\n\n**Request:** ${session.prompt}\n\n**Summary:** ${session.summary}\n\n**Files changed:** ${changes.length}\n\n---\n*Raised by Grassion AI Assistant*`,
        head: prBranch,
        base: branch
      },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    const prUrl = prRes.data.html_url;

    // Save PR URL
    await db.query('UPDATE chat_sessions SET pr_url = $1 WHERE id = $2', [prUrl, session_id]);

    res.json({ success: true, prUrl });
  } catch(e) {
    console.error('Chat PR error:', e.message);
    res.status(500).json({ error: 'Failed to raise PR: ' + e.message });
  }
});

// Get chat history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, repo, prompt, summary, pr_url, created_at FROM chat_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.session.user.id]
    ).catch(() => ({ rows: [] }));
    res.json({ sessions: result.rows });
  } catch(e) {
    res.json({ sessions: [] });
  }
});

module.exports = router;

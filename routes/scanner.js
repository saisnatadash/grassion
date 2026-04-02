const express = require('express');
const router = express.Router();
const { Octokit } = require('@octokit/rest');
const OpenAI = require('openai');
const db = require('../db');
const auth = require('../middleware/auth');

function getToken(req) {
  return req.session?.user?.accessToken || req.session?.user?.access_token || null;
}
function getOpenAI() {
  const k = process.env.OPENAI_API_KEY;
  if (!k || k.length < 20) return null;
  try { return new OpenAI({ apiKey: k }); } catch { return null; }
}

router.get('/stats', auth, async (req, res) => {
  try {
    const uid = req.session.user.id;
    const [sr, ur] = await Promise.all([
      db.query('SELECT COUNT(*) AS ts, COALESCE(SUM(issues_found),0) AS ti FROM scans WHERE user_id=$1', [uid]),
      db.query('SELECT plan, scans_used, bonus_scans FROM users WHERE id=$1', [uid])
    ]);
    const s = sr.rows[0], u = ur.rows[0] || {};
    const isPro = u.plan === 'pro';
    const limit = isPro ? null : 3 + (u.bonus_scans || 0);
    const used = u.scans_used || 0;
    res.json({
      total_scans: parseInt(s.ts) || 0,
      total_issues: parseInt(s.ti) || 0,
      prs_raised: 0,
      scans_used: used,
      bonus_scans: u.bonus_scans || 0,
      scans_left: isPro ? null : Math.max(0, limit - used),
      plan: u.plan || 'free'
    });
  } catch (e) {
    console.error('[Scanner] Stats error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/history', auth, async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, repo_name, branch, issues_found, status, scan_type, risk_level, pr_url, created_at FROM scans WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
      [req.session.user.id]
    );
    res.json({ scans: r.rows.map(s => ({ ...s, total_issues: s.issues_found, pr_raised: !!s.pr_url })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/scan', auth, async (req, res) => {
  const { owner, repo, branch = 'main' } = req.body;
  if (!owner || !repo) return res.status(400).json({ error: 'owner and repo required' });
  const uid = req.session.user.id;
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'No GitHub token. Sign out and reconnect GitHub.' });

  try {
    const { rows } = await db.query('SELECT plan, scans_used, bonus_scans FROM users WHERE id=$1', [uid]);
    const u = rows[0] || {};
    if (u.plan !== 'pro' && (u.scans_used || 0) >= 3 + (u.bonus_scans || 0))
      return res.status(403).json({ error: 'Free scan limit reached. Upgrade to Pro.', upgrade: true });
  } catch {}

  const openai = getOpenAI();
  if (!openai) return res.status(503).json({ error: 'OpenAI key not configured in Railway variables.' });

  try {
    const oc = new Octokit({ auth: token });
    let files = [];
    try {
      const { data: rd } = await oc.repos.get({ owner, repo });
      const { data: tree } = await oc.git.getTree({ owner, repo, tree_sha: branch || rd.default_branch, recursive: '1' });
      files = tree.tree.filter(f => f.type === 'blob' && !f.path.includes('node_modules') && !f.path.includes('dist/') && f.path.match(/\.(js|ts|py|go|rb|java|php|cs|jsx|tsx)$/)).slice(0, 20);
    } catch (e) { return res.status(500).json({ error: 'Cannot read repo: ' + e.message }); }

    let ctx = '';
    for (const f of files.slice(0, 8)) {
      try {
        const { data } = await oc.repos.getContent({ owner, repo, path: f.path, ref: branch });
        if (data.encoding === 'base64') { const c = Buffer.from(data.content, 'base64').toString('utf8'); if (c.length < 6000) ctx += `\n\n--- ${f.path} ---\n${c}`; }
      } catch {}
    }

    const cp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Security scanner. Return ONLY JSON: {"risk_level":"SAFE|LOW|MEDIUM|HIGH|CRITICAL","totalIssues":0,"results":[{"file":"path.js","issues":[{"method":"GET","endpoint":"/api/x","issue":"Missing auth"}]}],"summary":"text"}' },
        { role: 'user', content: `Repo: ${owner}/${repo}\n${ctx.substring(0, 14000)}` }
      ],
      max_tokens: 3000, temperature: 0.1, response_format: { type: 'json_object' }
    });

    let a;
    try { a = JSON.parse(cp.choices[0].message.content); } catch { a = { risk_level: 'SAFE', totalIssues: 0, results: [], summary: 'Scan complete.' }; }
    const found = a.totalIssues || (a.results || []).reduce((s, r) => s + (r.issues || []).length, 0);

    const { rows: sr } = await db.query(
      `INSERT INTO scans (user_id, repo_name, branch, issues_found, status, scan_type, risk_level, created_at) VALUES ($1,$2,$3,$4,'completed','manual',$5,NOW()) RETURNING id`,
      [uid, `${owner}/${repo}`, branch, found, a.risk_level || 'SAFE']
    );
    await db.query('UPDATE users SET scans_used=COALESCE(scans_used,0)+1 WHERE id=$1', [uid]).catch(() => {});
    res.json({ results: a.results || [], totalIssues: found, risk_level: a.risk_level || 'SAFE', summary: a.summary || '', scan_id: sr[0].id });
  } catch (e) {
    console.error('[Scanner] Scan error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/raise-pr', auth, async (req, res) => {
  const { owner, repo, results } = req.body;
  if (!owner || !repo) return res.status(400).json({ error: 'owner and repo required' });
  const uid = req.session.user.id;
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'No GitHub token.' });

  try {
    const { rows } = await db.query('SELECT plan FROM users WHERE id=$1', [uid]);
    if (rows[0]?.plan !== 'pro') return res.status(403).json({ error: 'Requires Pro plan.', upgrade: true });
  } catch {}

  try {
    const oc = new Octokit({ auth: token });
    const openai = getOpenAI();
    const { data: rd } = await oc.repos.get({ owner, repo });
    const base = rd.default_branch || 'main';
    const { data: ref } = await oc.git.getRef({ owner, repo, ref: `heads/${base}` });
    const nb = `grassion/fix-${Date.now()}`;
    await oc.git.createRef({ owner, repo, ref: `refs/heads/${nb}`, sha: ref.object.sha });

    const changed = [];
    if (openai && results?.length) {
      for (const fr of results.slice(0, 5)) {
        try {
          const { data: fd } = await oc.repos.getContent({ owner, repo, path: fr.file, ref: base });
          if (fd.encoding !== 'base64') continue;
          const orig = Buffer.from(fd.content, 'base64').toString('utf8');
          const fix = await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'system', content: 'Fix security issues. Return ONLY the complete fixed file, no markdown.' }, { role: 'user', content: `File: ${fr.file}\nIssues: ${JSON.stringify(fr.issues)}\n\n${orig.substring(0, 8000)}` }], max_tokens: 4000, temperature: 0.1 });
          await oc.repos.createOrUpdateFileContents({ owner, repo, path: fr.file, message: `fix: ${fr.file} [Grassion]`, content: Buffer.from(fix.choices[0].message.content).toString('base64'), branch: nb, sha: fd.sha });
          changed.push(fr.file);
        } catch {}
      }
    }
    if (!changed.length) {
      const notes = `# Security Issues\n\n${(results||[]).map(r=>`## ${r.file}\n${(r.issues||[]).map(i=>`- ${i.method} ${i.endpoint}: ${i.issue}`).join('\n')}`).join('\n\n')}`;
      await oc.repos.createOrUpdateFileContents({ owner, repo, path: 'SECURITY_FIXES.md', message: 'fix: Grassion security report', content: Buffer.from(notes).toString('base64'), branch: nb });
      changed.push('SECURITY_FIXES.md');
    }
    const { data: pr } = await oc.pulls.create({ owner, repo, title: '🛡️ Security fixes by Grassion', body: `Files: ${changed.map(f=>`\`${f}\``).join(', ')}\n\n*[Grassion](https://grassion.com)*`, head: nb, base });
    await db.query(`UPDATE scans SET pr_url=$1 WHERE user_id=$2 AND repo_name=$3 ORDER BY created_at DESC LIMIT 1`, [pr.html_url, uid, `${owner}/${repo}`]).catch(() => {});
    res.json({ success: true, prUrl: pr.html_url, pr_number: pr.number });
  } catch (e) {
    console.error('[Scanner] Raise PR error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
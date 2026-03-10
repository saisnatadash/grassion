import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import * as db from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// Webhook handler - receives PR events from GitHub
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const sig = req.headers['x-hub-signature-256'] as string;
    const event = req.headers['x-github-event'] as string;

    if (!sig || !event) { res.status(400).send('Missing headers'); return; }

    const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
    const hmac = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(hmac))) {
      res.status(401).send('Signature mismatch');
      return;
    }

    if (event !== 'pull_request') { res.json({ ok: true, skipped: true }); return; }

    const payload = req.body;
    const action: string = payload.action;
    const pr = payload.pull_request;
    const repoFullName: string = payload.repository?.full_name;

    if (!['opened', 'synchronize', 'reopened'].includes(action)) {
      res.json({ ok: true }); return;
    }

    // Find the repo + user
    const repoResult = await db.query(
      `SELECT r.id, r.user_id, u.plan FROM repos r JOIN users u ON u.id=r.user_id
       WHERE r.github_repo=$1 AND r.enabled=true LIMIT 1`,
      [repoFullName]
    );

    if (!repoResult.rows.length) { res.json({ ok: true, message: 'Repo not tracked' }); return; }

    const repo = repoResult.rows[0];

    // Basic risk analysis
    const addedLines: number = pr.additions || 0;
    const deletedLines: number = pr.deletions || 0;
    const changedFiles: number = pr.changed_files || 0;
    let riskLevel = 'low';
    let riskReason = 'Small, focused change';

    if (changedFiles > 20 || addedLines > 500) {
      riskLevel = 'high';
      riskReason = `Large PR: ${changedFiles} files changed, +${addedLines}/-${deletedLines} lines`;
    } else if (changedFiles > 5 || addedLines > 100) {
      riskLevel = 'medium';
      riskReason = `Medium PR: ${changedFiles} files changed`;
    }

    const aiSummary = repo.plan === 'free'
      ? null
      : `PR #${pr.number}: "${pr.title}" — ${riskLevel} risk. ${riskReason}. ${addedLines} additions, ${deletedLines} deletions across ${changedFiles} files.`;

    await db.query(
      `INSERT INTO pr_events(repo_id, user_id, pr_number, pr_title, pr_author, action, risk_level, risk_reason, ai_summary, blocked)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [repo.id, repo.user_id, pr.number, pr.title, pr.user?.login, action, riskLevel, riskReason, aiSummary, false]
    );

    await db.query(
      `INSERT INTO notifications(user_id, title, body, type)
       VALUES($1,$2,$3,'pr')`,
      [repo.user_id, `PR #${pr.number} ${action}`, `${pr.title} — ${riskLevel} risk`]
    );

    res.json({ ok: true, risk: riskLevel });
  } catch (e) {
    console.error('Webhook error', e);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Add a repo to track
router.post('/repos', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { github_repo } = req.body as { github_repo: string };
    if (!github_repo) { res.status(400).json({ error: 'github_repo required' }); return; }

    const [owner, repo_name] = github_repo.split('/');
    if (!owner || !repo_name) { res.status(400).json({ error: 'Format: owner/repo' }); return; }

    const result = await db.query(
      `INSERT INTO repos(user_id, github_repo, owner, repo_name)
       VALUES($1,$2,$3,$4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [req.user!.id, github_repo, owner, repo_name]
    );

    res.status(201).json({ ok: true, id: result.rows[0]?.id });
  } catch {
    res.status(500).json({ error: 'Failed to add repo' });
  }
});

// List user's repos
router.get('/repos', requireAuth, async (req: AuthRequest, res: Response) => {
  const result = await db.query(
    `SELECT id, github_repo, owner, repo_name, enabled, created_at FROM repos WHERE user_id=$1 ORDER BY created_at DESC`,
    [req.user!.id]
  );
  res.json(result.rows);
});

// PR events for user
router.get('/events', requireAuth, async (req: AuthRequest, res: Response) => {
  const result = await db.query(
    `SELECT pe.*, r.github_repo FROM pr_events pe
     JOIN repos r ON r.id=pe.repo_id
     WHERE pe.user_id=$1 ORDER BY pe.created_at DESC LIMIT 50`,
    [req.user!.id]
  );
  res.json(result.rows);
});

export default router;

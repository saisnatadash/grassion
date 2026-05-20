import { Router, type Request, type Response } from 'express'
import { eq, and } from 'drizzle-orm'
import { repos, pullRequests } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import { repoToggleSchema } from '@grassion/shared'
import { logger } from '../logger.js'

export const reposRouter = Router()

reposRouter.get('/api/repos', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const list = await db.select().from(repos).where(eq(repos.teamId, sess.teamId))
  res.json(
    list.map((r) => ({
      id: r.id,
      owner: r.owner,
      name: r.name,
      defaultBranch: r.defaultBranch,
      isActive: r.isActive,
      connectedAt: r.connectedAt.toISOString(),
      lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    })),
  )
})

/**
 * POST /api/repos/connect
 * Manually connect a public GitHub repo by URL without needing the GitHub App installed.
 * Fetches repo metadata from the public GitHub API and inserts into the repos table,
 * then back-fills the last 100 merged PRs so the dashboard has historical data.
 */
reposRouter.post(
  '/api/repos/connect',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    const { repoUrl } = req.body as { repoUrl?: string }
    if (!repoUrl || typeof repoUrl !== 'string') {
      res.status(400).json({ error: 'missing_repo_url' })
      return
    }

    // Parse owner/repo from GitHub URL
    const match = repoUrl.trim().match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/)
    if (!match) {
      res.status(400).json({ error: 'invalid_github_url', hint: 'Must be a github.com URL like https://github.com/owner/repo' })
      return
    }
    const [, owner, repoName] = match as [string, string, string]

    // Fetch repo metadata from GitHub public API
    let ghData: { id: number; name: string; full_name: string; default_branch: string; private: boolean } | null = null
    try {
      const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'grassion-app',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })
      if (!ghRes.ok) {
        const status = ghRes.status
        if (status === 404) {
          res.status(404).json({ error: 'repo_not_found', hint: 'Check the URL — private repos require the GitHub App to be installed.' })
          return
        }
        res.status(502).json({ error: 'github_api_error', status })
        return
      }
      ghData = (await ghRes.json()) as typeof ghData
    } catch (err) {
      logger.error({ err }, 'github api fetch failed in connect')
      res.status(502).json({ error: 'github_api_unreachable' })
      return
    }

    if (!ghData) {
      res.status(502).json({ error: 'github_api_empty' })
      return
    }

    // Upsert — if already connected, just return success
    const existing = await db
      .select({ id: repos.id })
      .from(repos)
      .where(eq(repos.githubRepoId, ghData.id))
      .limit(1)

    if (existing[0]) {
      res.json({ ok: true, repoName: ghData.full_name, prsSynced: 0, alreadyConnected: true })
      return
    }

    const [newRepo] = await db
      .insert(repos)
      .values({
        teamId: sess.teamId,
        githubRepoId: ghData.id,
        owner,
        name: ghData.name,
        defaultBranch: ghData.default_branch,
        isActive: true,
      })
      .returning({ id: repos.id })

    if (!newRepo) {
      res.status(500).json({ error: 'insert_failed' })
      return
    }

    logger.info({ teamId: sess.teamId, repo: ghData.full_name }, 'repo manually connected')

    // Back-fill last 100 merged PRs
    const prsSynced = await syncHistoricalPrs(sess.teamId, newRepo.id, owner, ghData.name)

    res.json({ ok: true, repoName: ghData.full_name, prsSynced })
  },
)

async function syncHistoricalPrs(
  teamId: string,
  repoId: string,
  owner: string,
  repoName: string,
): Promise<number> {
  let ghPrs: GhPr[] = []
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pulls?state=closed&per_page=100&sort=updated`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'grassion-app',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )
    if (!res.ok) {
      logger.warn({ status: res.status, owner, repoName }, 'github pulls fetch failed during sync')
      return 0
    }
    ghPrs = (await res.json()) as GhPr[]
  } catch (err) {
    logger.error({ err }, 'github pulls fetch threw during sync')
    return 0
  }

  const merged = ghPrs.filter((p) => !!p.merged_at)
  if (merged.length === 0) return 0

  const rows = merged.map((pr) => {
    const labels = (pr.labels ?? []).map((l) => l.name)
    const aiSource = detectAiSource(labels, pr.title, pr.body)
    return {
      teamId,
      repoId,
      githubPrId: pr.id,
      githubPrNumber: pr.number,
      title: pr.title,
      state: 'merged' as const,
      authorLogin: pr.user?.login ?? null,
      openedAt: new Date(pr.created_at),
      mergedAt: new Date(pr.merged_at!),
      closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      aiSource,
      aiDetectionMethod: aiSource ? 'body_regex' : null,
    }
  })

  try {
    await db.insert(pullRequests).values(rows).onConflictDoNothing()
  } catch (err) {
    logger.error({ err }, 'pr bulk insert failed during sync')
    return 0
  }

  return rows.length
}

interface GhPr {
  id: number
  number: number
  title: string
  body: string | null
  state: string
  merged_at: string | null
  closed_at: string | null
  created_at: string
  user: { login: string } | null
  labels: { name: string }[]
}

function detectAiSource(labels: string[], title: string, body: string | null): string | null {
  const lowerLabels = labels.map((l) => l.toLowerCase())
  if (lowerLabels.some((l) => l.includes('copilot'))) return 'copilot'
  if (lowerLabels.some((l) => l.includes('cursor'))) return 'cursor'
  if (lowerLabels.some((l) => l.includes('claude'))) return 'claude-code'
  if (lowerLabels.some((l) => l.includes('codeium'))) return 'codeium'

  const lowerBody = (body ?? '').toLowerCase()
  if (lowerBody.includes('co-authored-by: github copilot')) return 'copilot'
  if (lowerBody.includes('cursor')) return 'cursor'

  if (/^(feat|fix|add)[\s:(]/i.test(title)) return 'copilot'

  return null
}

reposRouter.post(
  '/api/repos/:id/toggle',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    const parsed = repoToggleSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input' })
      return
    }
    const id = req.params.id
    if (!id) {
      res.status(400).json({ error: 'missing_id' })
      return
    }
    await db
      .update(repos)
      .set({ isActive: parsed.data.isActive })
      .where(and(eq(repos.id, id), eq(repos.teamId, sess.teamId)))
    res.json({ ok: true })
  },
)

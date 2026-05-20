import { Router, type Request, type Response } from 'express'
import { eq, and } from 'drizzle-orm'
import { repos } from '@grassion/db'
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
 * Fetches repo metadata from the public GitHub API and inserts into the repos table.
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
      res.json({ ok: true, repoName: ghData.full_name, prCount: 0, alreadyConnected: true })
      return
    }

    await db.insert(repos).values({
      teamId: sess.teamId,
      githubRepoId: ghData.id,
      owner,
      name: ghData.name,
      defaultBranch: ghData.default_branch,
      isActive: true,
    })

    logger.info({ teamId: sess.teamId, repo: ghData.full_name }, 'repo manually connected')
    res.json({ ok: true, repoName: ghData.full_name, prCount: 0 })
  },
)

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

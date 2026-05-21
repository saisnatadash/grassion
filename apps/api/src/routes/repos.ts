import { Router, type Request, type Response } from 'express'
import { eq, and, sql } from 'drizzle-orm'
import { repos, pullRequests, teams } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import { repoToggleSchema } from '@grassion/shared'
import { logger } from '../logger.js'
import { getInstallationOctokit } from '../github.js'

export const reposRouter = Router()

reposRouter.get('/api/repos', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const list = await db
    .select({
      id: repos.id,
      owner: repos.owner,
      name: repos.name,
      defaultBranch: repos.defaultBranch,
      isActive: repos.isActive,
      connectedAt: repos.connectedAt,
      lastSyncedAt: repos.lastSyncedAt,
      prCount: sql<number>`(SELECT COUNT(*)::int FROM pull_requests WHERE pull_requests.repo_id = repos.id)`,
    })
    .from(repos)
    .where(eq(repos.teamId, sess.teamId))
  res.json(
    list.map((r) => ({
      id: r.id,
      owner: r.owner,
      name: r.name,
      defaultBranch: r.defaultBranch,
      isActive: r.isActive,
      connectedAt: r.connectedAt.toISOString(),
      lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
      prCount: r.prCount ?? 0,
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
  // Build authenticated headers when a GitHub App installation is available.
  // Without auth: 60 req/hr limit; 100 PRs × 2 calls = 200 requests → needs auth.
  const teamRow = (
    await db
      .select({ githubInstallationId: teams.githubInstallationId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
  )[0]

  const ghHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'grassion-app',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const installationId = teamRow?.githubInstallationId ?? null
  if (installationId) {
    try {
      const octokit = await getInstallationOctokit(installationId)
      const auth = await (octokit as unknown as { auth: (o: { type: string }) => Promise<{ token: string }> })
        .auth({ type: 'installation' })
      ghHeaders['Authorization'] = `Bearer ${auth.token}`
    } catch (err) {
      logger.warn({ err }, 'installation token unavailable, falling back to unauthenticated sync')
    }
  }

  // Fetch last 100 closed PRs
  let ghPrs: GhPr[] = []
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pulls?state=closed&per_page=100&sort=updated`,
      { headers: ghHeaders },
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

  // Deep detection for each PR (commits + files in parallel per PR)
  const rows: Array<{
    teamId: string
    repoId: string
    githubPrId: number
    githubPrNumber: number
    title: string
    state: 'merged'
    authorLogin: string | null
    authorGithubId: number | null
    openedAt: Date
    mergedAt: Date
    closedAt: Date | null
    additions: number
    deletions: number
    changedFiles: number
    aiSource: string | null
    aiDetectionMethod: string | null
    aiConfidence: number
  }> = []

  for (const pr of merged) {
    const d = await detectAiSourceDeep(owner, repoName, pr, ghHeaders)
    rows.push({
      teamId,
      repoId,
      githubPrId: pr.id,
      githubPrNumber: pr.number,
      title: pr.title,
      state: 'merged',
      authorLogin: pr.user?.login ?? null,
      authorGithubId: pr.user?.id ?? null,
      openedAt: new Date(pr.created_at),
      mergedAt: new Date(pr.merged_at!),
      closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
      additions: d.additions,
      deletions: d.deletions,
      changedFiles: d.changedFiles,
      aiSource: d.aiSource,
      aiDetectionMethod: d.aiDetectionMethod,
      aiConfidence: d.aiConfidence,
    })
  }

  try {
    await db.insert(pullRequests).values(rows).onConflictDoNothing()
  } catch (err) {
    logger.error({ err }, 'pr bulk insert failed during sync')
    return 0
  }

  logger.info(
    { teamId, repoName, total: rows.length, aiDetected: rows.filter((r) => r.aiSource).length },
    'historical PR sync complete',
  )
  return rows.length
}

/* ── GitHub API types ─────────────────────────────────── */

interface GhPr {
  id: number
  number: number
  title: string
  body: string | null
  state: string
  merged_at: string | null
  closed_at: string | null
  created_at: string
  commits?: number
  user: { login: string; id: number } | null
  labels: { name: string }[]
}

interface GhCommit {
  commit: { message: string }
}

interface GhFile {
  filename: string
  additions: number
  deletions: number
  changes: number
}

interface DetectionResult {
  aiSource: string | null
  aiDetectionMethod: string | null
  aiConfidence: number
  additions: number
  deletions: number
  changedFiles: number
}

/* ── Fetch helper ─────────────────────────────────────── */

async function fetchGhJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(url, { headers })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/* ── Main detection orchestrator ──────────────────────── */

async function detectAiSourceDeep(
  owner: string,
  repoName: string,
  pr: GhPr,
  ghHeaders: Record<string, string>,
): Promise<DetectionResult> {
  // 1. Labels — explicit signal, no extra API call needed
  const labelResult = detectFromLabels(pr.labels ?? [])
  if (labelResult) {
    return { ...labelResult, additions: 0, deletions: 0, changedFiles: 0 }
  }

  // 2 + 3. Fetch commits and files in parallel
  const [commitsData, filesData] = await Promise.allSettled([
    fetchGhJson<GhCommit[]>(
      `https://api.github.com/repos/${owner}/${repoName}/pulls/${pr.number}/commits?per_page=100`,
      ghHeaders,
    ),
    fetchGhJson<GhFile[]>(
      `https://api.github.com/repos/${owner}/${repoName}/pulls/${pr.number}/files?per_page=100`,
      ghHeaders,
    ),
  ])

  let additions = 0
  let deletions = 0
  let changedFiles = 0

  // 2. Commit message analysis (strongest after labels)
  if (commitsData.status === 'fulfilled' && commitsData.value) {
    const commitResult = analyzeCommits(commitsData.value)
    if (commitResult) {
      // Still collect file stats even if we already have a commit signal
      if (filesData.status === 'fulfilled' && filesData.value) {
        const files = filesData.value
        additions = files.reduce((s, f) => s + (f.additions ?? 0), 0)
        deletions = files.reduce((s, f) => s + (f.deletions ?? 0), 0)
        changedFiles = files.length
      }
      return { ...commitResult, additions, deletions, changedFiles }
    }
  }

  // 3a. File change pattern analysis + collect actual file stats
  if (filesData.status === 'fulfilled' && filesData.value) {
    const files = filesData.value
    additions = files.reduce((s, f) => s + (f.additions ?? 0), 0)
    deletions = files.reduce((s, f) => s + (f.deletions ?? 0), 0)
    changedFiles = files.length
    const fileResult = analyzeFiles(files)
    if (fileResult) return { ...fileResult, additions, deletions, changedFiles }
  }

  // 3b. PR metadata signals (uses commit count from PR list response)
  const metaResult = analyzeMetadata(pr, additions)
  if (metaResult) return { ...metaResult, additions, deletions, changedFiles }

  // 4. Body / title keyword fallback
  const bodyResult = detectFromBody(pr.title, pr.body)
  if (bodyResult) return { ...bodyResult, additions, deletions, changedFiles }

  return { aiSource: null, aiDetectionMethod: null, aiConfidence: 0, additions, deletions, changedFiles }
}

/* ── Signal detectors (in priority order) ────────────── */

type PartialResult = { aiSource: string; aiDetectionMethod: string; aiConfidence: number }

function detectFromLabels(labels: { name: string }[]): PartialResult | null {
  const lower = labels.map((l) => l.name.toLowerCase())
  if (lower.some((l) => l.includes('copilot')))  return { aiSource: 'copilot',     aiDetectionMethod: 'label', aiConfidence: 0.95 }
  if (lower.some((l) => l.includes('cursor')))   return { aiSource: 'cursor',      aiDetectionMethod: 'label', aiConfidence: 0.95 }
  if (lower.some((l) => l.includes('claude')))   return { aiSource: 'claude-code', aiDetectionMethod: 'label', aiConfidence: 0.95 }
  if (lower.some((l) => l.includes('codeium')))  return { aiSource: 'codeium',     aiDetectionMethod: 'label', aiConfidence: 0.95 }
  if (lower.some((l) => l.includes('windsurf'))) return { aiSource: 'windsurf',    aiDetectionMethod: 'label', aiConfidence: 0.95 }
  if (lower.some((l) => l.includes('tabnine')))  return { aiSource: 'tabnine',     aiDetectionMethod: 'label', aiConfidence: 0.95 }
  return null
}

function analyzeCommits(commits: GhCommit[]): PartialResult | null {
  for (const c of commits) {
    const lower = c.commit.message.toLowerCase()
    // Co-authored-by trailer is the strongest commit signal — the tool signed it explicitly
    if (lower.includes('co-authored-by: github copilot')) return { aiSource: 'copilot',     aiDetectionMethod: 'commit_coauthor', aiConfidence: 1.0 }
    if (lower.includes('co-authored-by: cursor'))         return { aiSource: 'cursor',      aiDetectionMethod: 'commit_coauthor', aiConfidence: 1.0 }
    if (lower.includes('co-authored-by: claude'))         return { aiSource: 'claude-code', aiDetectionMethod: 'commit_coauthor', aiConfidence: 1.0 }
    if (lower.includes('co-authored-by: codeium'))        return { aiSource: 'codeium',     aiDetectionMethod: 'commit_coauthor', aiConfidence: 1.0 }
    // Robot emoji is a common AI-generation marker
    if (c.commit.message.includes('🤖'))                  return { aiSource: 'ai-assisted', aiDetectionMethod: 'commit_emoji',    aiConfidence: 0.80 }
    // Keyword matches — weaker but reliable
    if (lower.includes('claude'))   return { aiSource: 'claude-code', aiDetectionMethod: 'commit_keyword', aiConfidence: 0.85 }
    if (lower.includes('codeium'))  return { aiSource: 'codeium',     aiDetectionMethod: 'commit_keyword', aiConfidence: 0.85 }
    if (lower.includes('copilot'))  return { aiSource: 'copilot',     aiDetectionMethod: 'commit_keyword', aiConfidence: 0.85 }
    if (lower.includes('cursor'))   return { aiSource: 'cursor',      aiDetectionMethod: 'commit_keyword', aiConfidence: 0.85 }
    if (lower.includes('tabnine'))  return { aiSource: 'tabnine',     aiDetectionMethod: 'commit_keyword', aiConfidence: 0.85 }
    if (lower.includes('windsurf')) return { aiSource: 'windsurf',    aiDetectionMethod: 'commit_keyword', aiConfidence: 0.85 }
  }
  return null
}

function analyzeFiles(files: GhFile[]): PartialResult | null {
  // Single file with 200+ pure additions and zero deletions → bulk generation
  if (files.some((f) => f.additions > 200 && f.deletions === 0)) {
    return { aiSource: 'ai-assisted', aiDetectionMethod: 'file_pattern', aiConfidence: 0.75 }
  }
  // Average changes per file > 50 across the whole PR → high-volume AI output
  const totalChanges = files.reduce((s, f) => s + f.changes, 0)
  if (files.length > 0 && totalChanges / files.length > 50) {
    return { aiSource: 'ai-assisted', aiDetectionMethod: 'file_ratio', aiConfidence: 0.65 }
  }
  return null
}

function analyzeMetadata(pr: GhPr, additions: number): PartialResult | null {
  if (pr.merged_at) {
    const minutesDelta =
      (new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime()) / 60_000
    // Merged within 30 min of opening — uncommon for human-written + reviewed code
    if (minutesDelta >= 0 && minutesDelta <= 30) {
      return { aiSource: 'ai-assisted', aiDetectionMethod: 'time_pattern', aiConfidence: 0.65 }
    }
  }
  // 500+ additions but only 1–2 commits → bulk generation in a single pass
  if (additions >= 500 && (pr.commits ?? 999) <= 2) {
    return { aiSource: 'ai-assisted', aiDetectionMethod: 'bulk_generation', aiConfidence: 0.70 }
  }
  return null
}

function detectFromBody(title: string, body: string | null): PartialResult | null {
  // Ordered: longer/more specific phrases first to avoid partial matches overriding them
  const matchers: Array<[string, string]> = [
    ['co-authored-by: github copilot', 'copilot'],
    ['co-authored-by: cursor',         'cursor'],
    ['co-authored-by: claude',         'claude-code'],
    ['co-authored-by: codeium',        'codeium'],
    ['github copilot',                 'copilot'],
    ['ai generated',                   'ai-assisted'],
    ['generated by ai',                'ai-assisted'],
    ['generated by',                   'ai-assisted'],
    ['copilot',                        'copilot'],
    ['claude code',                    'claude-code'],
    ['cursor ai',                      'cursor'],
    ['claude',                         'claude-code'],
    ['cursor',                         'cursor'],
    ['codeium',                        'codeium'],
    ['tabnine',                        'tabnine'],
    ['windsurf',                       'windsurf'],
  ]

  const lowerBody = (body ?? '').toLowerCase()
  for (const [pattern, source] of matchers) {
    if (lowerBody.includes(pattern)) {
      return { aiSource: source, aiDetectionMethod: 'body_keyword', aiConfidence: 0.60 }
    }
  }

  const lowerTitle = title.toLowerCase()
  for (const [pattern, source] of matchers) {
    if (lowerTitle.includes(pattern)) {
      return { aiSource: source, aiDetectionMethod: 'title_keyword', aiConfidence: 0.50 }
    }
  }

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

reposRouter.delete(
  '/api/repos/:id',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    const { id } = req.params
    if (!id) {
      res.status(400).json({ error: 'missing_id' })
      return
    }
    const deleted = await db
      .delete(repos)
      .where(and(eq(repos.id, id), eq(repos.teamId, sess.teamId)))
      .returning({ id: repos.id })
    if (!deleted.length) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    logger.info({ teamId: sess.teamId, repoId: id }, 'repo disconnected')
    res.json({ ok: true })
  },
)

reposRouter.post(
  '/api/repos/sync/:id',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    const { id } = req.params
    if (!id) {
      res.status(400).json({ error: 'missing_id' })
      return
    }
    const existing = await db
      .select()
      .from(repos)
      .where(and(eq(repos.id, id), eq(repos.teamId, sess.teamId)))
      .limit(1)
    const repo = existing[0]
    if (!repo) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    const prsSynced = await syncHistoricalPrs(sess.teamId, repo.id, repo.owner, repo.name)
    await db.update(repos).set({ lastSyncedAt: new Date() }).where(eq(repos.id, id))
    logger.info({ teamId: sess.teamId, repoId: id, prsSynced }, 'repo manually synced')
    res.json({ ok: true, prsSynced })
  },
)

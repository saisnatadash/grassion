import { eq, and } from 'drizzle-orm'
import { pullRequests, repos, outcomeCheckQueue, type NewPullRequest } from '@grassion/db'
import { db } from '../db.js'
import { logger } from '../logger.js'
import { detectAI, type PRForDetection } from './ai-detection.js'
import { getInstallationOctokit } from '../github.js'

interface PullRequestWebhookPayload {
  installation?: { id: number } | null
  repository: { id: number; full_name: string }
  pull_request: {
    id: number
    number: number
    title: string
    body: string | null
    state: 'open' | 'closed'
    merged?: boolean | null
    merge_commit_sha: string | null
    additions?: number
    deletions?: number
    changed_files?: number
    commits?: number
    user: { id: number; login: string } | null
    created_at: string
    merged_at: string | null
    closed_at: string | null
    labels: Array<{ name: string }>
  }
}

export async function upsertPRFromWebhook(payload: PullRequestWebhookPayload) {
  const repoRow = await db
    .select()
    .from(repos)
    .where(eq(repos.githubRepoId, payload.repository.id))
    .limit(1)
  const repo = repoRow[0]
  if (!repo) {
    logger.warn({ repoId: payload.repository.id }, 'PR webhook for unknown repo')
    return null
  }

  const pr = payload.pull_request
  const installationId = payload.installation?.id

  const commits = installationId ? await fetchPrCommits(installationId, repo.owner, repo.name, pr.number) : []

  const detection = detectAI({
    body: pr.body,
    labels: pr.labels.map((l) => l.name),
    commits,
  })

  const state: 'open' | 'merged' | 'closed' =
    pr.state === 'open' ? 'open' : pr.merged ? 'merged' : 'closed'

  const insert: NewPullRequest = {
    teamId: repo.teamId,
    repoId: repo.id,
    githubPrId: pr.id,
    githubPrNumber: pr.number,
    title: pr.title,
    state,
    authorGithubId: pr.user?.id,
    authorLogin: pr.user?.login,
    openedAt: new Date(pr.created_at),
    mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
    closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
    mergeCommitSha: pr.merge_commit_sha,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles: pr.changed_files ?? 0,
    commitCount: pr.commits ?? commits.length,
    aiSource: detection.source,
    aiDetectionMethod: detection.method,
    aiConfidence: detection.confidence,
    rawMetadata: {
      body: pr.body,
      labels: pr.labels.map((l) => ({ name: l.name })),
      commits: commits.map((c) => ({ message: c.message, author: c.author })),
    },
    updatedAt: new Date(),
  }

  const [row] = await db
    .insert(pullRequests)
    .values(insert)
    .onConflictDoUpdate({
      target: pullRequests.githubPrId,
      set: {
        title: insert.title,
        state: insert.state,
        mergedAt: insert.mergedAt,
        closedAt: insert.closedAt,
        mergeCommitSha: insert.mergeCommitSha,
        additions: insert.additions,
        deletions: insert.deletions,
        changedFiles: insert.changedFiles,
        commitCount: insert.commitCount,
        aiSource: insert.aiSource,
        aiDetectionMethod: insert.aiDetectionMethod,
        aiConfidence: insert.aiConfidence,
        rawMetadata: insert.rawMetadata,
        updatedAt: new Date(),
      },
    })
    .returning()

  return row!
}

async function fetchPrCommits(
  installationId: number,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<Array<{ message: string; author: { name?: string; email?: string } }>> {
  try {
    const octokit = await getInstallationOctokit(installationId)
    const res = await octokit.pulls.listCommits({ owner, repo, pull_number: pullNumber, per_page: 100 })
    return res.data.map((c) => ({
      message: c.commit.message,
      author: { name: c.commit.author?.name, email: c.commit.author?.email },
    }))
  } catch (err) {
    logger.warn({ err, owner, repo, pullNumber }, 'failed to fetch PR commits for AI detection')
    return []
  }
}

export async function recomputeAIForPR(prGithubId: number) {
  const row = await db.select().from(pullRequests).where(eq(pullRequests.githubPrId, prGithubId)).limit(1)
  const pr = row[0]
  if (!pr) return
  const meta = (pr.rawMetadata ?? {}) as {
    body?: string | null
    labels?: Array<{ name: string }>
    commits?: Array<{ message: string; author: { name?: string; email?: string } }>
  }
  const detection = detectAI({
    body: meta.body ?? null,
    labels: (meta.labels ?? []).map((l) => l.name),
    commits: meta.commits ?? [],
  })
  await db
    .update(pullRequests)
    .set({
      aiSource: detection.source,
      aiDetectionMethod: detection.method,
      aiConfidence: detection.confidence,
      updatedAt: new Date(),
    })
    .where(eq(pullRequests.id, pr.id))
}

export async function scheduleOutcomeCheck(prDbId: string, runAfter: Date) {
  await db
    .insert(outcomeCheckQueue)
    .values({ prId: prDbId, runAfter })
    .onConflictDoUpdate({
      target: outcomeCheckQueue.prId,
      set: { runAfter, completedAt: null, attempts: 0, lastError: null },
    })
}

export async function storeCheckRun(githubRepoId: number, checkRun: {
  name?: string
  head_sha?: string
  conclusion?: string | null
  status?: string
  completed_at?: string | null
}) {
  if (!checkRun.head_sha) return
  const repoRow = await db.select().from(repos).where(eq(repos.githubRepoId, githubRepoId)).limit(1)
  const repo = repoRow[0]
  if (!repo) return

  // Find a PR whose merge_commit_sha matches; the SHA can also be the PR head before merge.
  const prRow = await db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.repoId, repo.id), eq(pullRequests.mergeCommitSha, checkRun.head_sha)))
    .limit(1)
  const pr = prRow[0]
  if (!pr) return

  const meta = (pr.rawMetadata ?? {}) as { check_runs?: unknown[] }
  const list = Array.isArray(meta.check_runs) ? meta.check_runs : []
  list.push({
    name: checkRun.name,
    conclusion: checkRun.conclusion,
    status: checkRun.status,
    completed_at: checkRun.completed_at,
  })
  await db
    .update(pullRequests)
    .set({ rawMetadata: { ...meta, check_runs: list }, updatedAt: new Date() })
    .where(eq(pullRequests.id, pr.id))
}

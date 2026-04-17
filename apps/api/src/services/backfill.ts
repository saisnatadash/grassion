import { db } from '../db.js'
import { repos, pullRequests, type NewPullRequest } from '@grassion/db'
import { eq } from 'drizzle-orm'
import { getInstallationOctokit } from '../github.js'
import { detectAI } from './ai-detection.js'
import { logger } from '../logger.js'
import { daysAgo } from '@grassion/shared'

const BACKFILL_DAYS = 60

/**
 * On install, fetch the last 60 days of PRs per repo and persist them.
 * Idempotent: ON CONFLICT updates existing rows.
 */
export async function backfillTeamRepos(teamId: string, installationId: number) {
  const teamRepos = await db.select().from(repos).where(eq(repos.teamId, teamId))
  for (const repo of teamRepos) {
    if (!repo.isActive) continue
    try {
      await backfillRepo(installationId, repo.id, repo.owner, repo.name, repo.teamId)
    } catch (err) {
      logger.error({ err, repo: repo.name }, 'backfill failed for repo')
    }
  }
}

async function backfillRepo(
  installationId: number,
  repoDbId: string,
  owner: string,
  name: string,
  teamId: string,
) {
  const octokit = await getInstallationOctokit(installationId)
  const since = daysAgo(BACKFILL_DAYS)
  let page = 1
  let total = 0

  while (true) {
    const res = await octokit.pulls.list({
      owner,
      repo: name,
      state: 'all',
      sort: 'created',
      direction: 'desc',
      per_page: 100,
      page,
    })
    if (res.data.length === 0) break

    for (const pr of res.data) {
      const createdAt = new Date(pr.created_at)
      if (createdAt < since) {
        await db
          .update(repos)
          .set({ lastSyncedAt: new Date() })
          .where(eq(repos.id, repoDbId))
        logger.info({ owner, name, total }, 'backfill complete')
        return
      }

      const commitsRes = await octokit.pulls.listCommits({
        owner,
        repo: name,
        pull_number: pr.number,
        per_page: 100,
      })
      const commits = commitsRes.data.map((c) => ({
        message: c.commit.message,
        author: { name: c.commit.author?.name, email: c.commit.author?.email },
      }))

      const detection = detectAI({
        body: pr.body ?? null,
        labels: pr.labels.map((l) => l.name),
        commits,
      })

      const state: 'open' | 'merged' | 'closed' =
        pr.state === 'open' ? 'open' : pr.merged_at ? 'merged' : 'closed'

      const insert: NewPullRequest = {
        teamId,
        repoId: repoDbId,
        githubPrId: pr.id,
        githubPrNumber: pr.number,
        title: pr.title,
        state,
        authorGithubId: pr.user?.id,
        authorLogin: pr.user?.login,
        openedAt: createdAt,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
        mergeCommitSha: pr.merge_commit_sha,
        aiSource: detection.source,
        aiDetectionMethod: detection.method,
        aiConfidence: detection.confidence,
        rawMetadata: {
          body: pr.body,
          labels: pr.labels.map((l) => ({ name: l.name })),
          commits,
        },
        updatedAt: new Date(),
      }

      await db
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
            aiSource: insert.aiSource,
            aiDetectionMethod: insert.aiDetectionMethod,
            aiConfidence: insert.aiConfidence,
            rawMetadata: insert.rawMetadata,
            updatedAt: new Date(),
          },
        })
      total++
    }

    if (res.data.length < 100) break
    page++
  }

  await db.update(repos).set({ lastSyncedAt: new Date() }).where(eq(repos.id, repoDbId))
  logger.info({ owner, name, total }, 'backfill complete')
}

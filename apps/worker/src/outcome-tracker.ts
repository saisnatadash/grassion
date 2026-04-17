import { eq, and, gte, lte, gt, lt, isNull, isNotNull } from 'drizzle-orm'
import {
  pullRequests,
  prOutcomes,
  repos,
  outcomeCheckQueue,
  type PullRequest,
  type Repo,
} from '@grassion/db'
import { db } from './db.js'
import { logger } from './logger.js'
import { daysAgo, addDays } from '@grassion/shared'
import { summarizeProblemPR } from './llm/pr-summary.js'
import { computeReworkScore } from './scoring.js'

export { computeReworkScore }

/**
 * Runs every 6 hours. For each merged PR aged 7-30 days, compute outcomes.
 * Why 7-30 days: <7 is too early for rework signals; >30 is historical, not worth re-checking.
 */
export async function trackAllPendingOutcomes() {
  const start = Date.now()
  const due = await db
    .select({ row: outcomeCheckQueue, pr: pullRequests, repo: repos })
    .from(outcomeCheckQueue)
    .innerJoin(pullRequests, eq(pullRequests.id, outcomeCheckQueue.prId))
    .innerJoin(repos, eq(repos.id, pullRequests.repoId))
    .where(and(isNull(outcomeCheckQueue.completedAt), lte(outcomeCheckQueue.runAfter, new Date())))
    .limit(500)

  let ok = 0
  let failed = 0
  for (const item of due) {
    try {
      await computeAndStoreOutcome(item.pr, item.repo)
      await db
        .update(outcomeCheckQueue)
        .set({ completedAt: new Date() })
        .where(eq(outcomeCheckQueue.id, item.row.id))
      ok++
    } catch (err) {
      failed++
      await db
        .update(outcomeCheckQueue)
        .set({
          attempts: (item.row.attempts ?? 0) + 1,
          lastError: err instanceof Error ? err.message : String(err),
          runAfter: addDays(new Date(), 1),
        })
        .where(eq(outcomeCheckQueue.id, item.row.id))
      logger.error({ err, prId: item.pr.id }, 'outcome computation failed')
    }
  }

  logger.info({ ok, failed, durationMs: Date.now() - start }, 'outcome tracker run complete')

  // Sweep PRs merged 7-30 days ago that aren't enqueued yet (catch-up for missed webhooks).
  await enqueueMissedOutcomes()
}

async function enqueueMissedOutcomes() {
  const upper = daysAgo(7)
  const lower = daysAgo(30)
  const merged = await db
    .select({ id: pullRequests.id })
    .from(pullRequests)
    .leftJoin(outcomeCheckQueue, eq(outcomeCheckQueue.prId, pullRequests.id))
    .where(
      and(
        eq(pullRequests.state, 'merged'),
        isNotNull(pullRequests.mergedAt),
        gte(pullRequests.mergedAt, lower),
        lte(pullRequests.mergedAt, upper),
        isNull(outcomeCheckQueue.id),
      ),
    )
    .limit(1000)
  for (const m of merged) {
    await db
      .insert(outcomeCheckQueue)
      .values({ prId: m.id, runAfter: new Date() })
      .onConflictDoNothing()
  }
}

export async function computeAndStoreOutcome(pr: PullRequest, repo: Repo) {
  if (!pr.mergedAt) return
  const outcome = await computeOutcome(pr, repo)

  // Generate (or refresh) the AI summary only for genuinely problematic PRs to keep cost bounded.
  let aiSummary: string | null = null
  let aiSummaryGeneratedAt: Date | null = null
  if (outcome.reworkScore >= 30) {
    const existing = (
      await db
        .select({ aiSummary: prOutcomes.aiSummary })
        .from(prOutcomes)
        .where(eq(prOutcomes.prId, pr.id))
        .limit(1)
    )[0]
    if (!existing?.aiSummary) {
      try {
        aiSummary = await summarizeProblemPR({
          title: pr.title,
          authorLogin: pr.authorLogin,
          additions: pr.additions ?? 0,
          deletions: pr.deletions ?? 0,
          outcome: {
            wasReverted: outcome.wasReverted,
            downstreamFixCount: outcome.downstreamFixCount,
            ciFailureCount: outcome.ciFailureCount,
            hadHotfixWithin7d: outcome.hadHotfixWithin7d,
          },
        })
        aiSummaryGeneratedAt = new Date()
      } catch (err) {
        logger.warn({ err, prId: pr.id }, 'pr summary generation failed; continuing without summary')
      }
    }
  }

  await db
    .insert(prOutcomes)
    .values({ ...outcome, aiSummary, aiSummaryGeneratedAt })
    .onConflictDoUpdate({
      target: prOutcomes.prId,
      set: {
        wasReverted: outcome.wasReverted,
        revertedAt: outcome.revertedAt,
        revertPrNumber: outcome.revertPrNumber,
        ciFailureCount: outcome.ciFailureCount,
        downstreamFixCount: outcome.downstreamFixCount,
        downstreamFixPrNumbers: outcome.downstreamFixPrNumbers,
        hadHotfixWithin7d: outcome.hadHotfixWithin7d,
        reworkScore: outcome.reworkScore,
        ...(aiSummary
          ? { aiSummary, aiSummaryGeneratedAt: aiSummaryGeneratedAt ?? new Date() }
          : {}),
        computedAt: new Date(),
      },
    })
}

async function computeOutcome(pr: PullRequest, _repo: Repo) {
  const revertPr = await findRevertPR(pr)
  const downstreamFixes = await findDownstreamFixPRs(pr)
  const ciFailures = countCIFailures(pr)
  const hadHotfix = await checkHotfixWithin7d(pr)

  const reworkScore = computeReworkScore({
    wasReverted: !!revertPr,
    downstreamFixCount: downstreamFixes.length,
    ciFailureCount: ciFailures,
    hadHotfix,
  })

  return {
    prId: pr.id,
    teamId: pr.teamId,
    wasReverted: !!revertPr,
    revertedAt: revertPr?.mergedAt ?? null,
    revertPrNumber: revertPr?.githubPrNumber ?? null,
    ciFailureCount: ciFailures,
    downstreamFixCount: downstreamFixes.length,
    downstreamFixPrNumbers: downstreamFixes.map((p) => p.githubPrNumber),
    hadHotfixWithin7d: hadHotfix,
    reworkScore,
    computedAt: new Date(),
  }
}

async function findRevertPR(pr: PullRequest) {
  if (!pr.mergedAt) return null
  // GitHub convention: revert PR title is `Revert "<original title>"`.
  const candidates = await db
    .select()
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.repoId, pr.repoId),
        eq(pullRequests.state, 'merged'),
        gt(pullRequests.mergedAt, pr.mergedAt),
      ),
    )
  const exact = `Revert "${pr.title}"`
  const prefix = `Revert "${pr.title.slice(0, 30)}`
  return candidates.find((c) => c.title === exact || c.title.startsWith(prefix)) ?? null
}

async function findDownstreamFixPRs(pr: PullRequest) {
  if (!pr.mergedAt) return []
  const refPattern = new RegExp(
    `(fix(?:es)?|close[sd]?|resolve[sd]?)\\s+#${pr.githubPrNumber}\\b`,
    'i',
  )
  const recent = await db
    .select()
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.repoId, pr.repoId),
        eq(pullRequests.state, 'merged'),
        gt(pullRequests.mergedAt, pr.mergedAt),
        lt(pullRequests.mergedAt, addDays(pr.mergedAt, 30)),
      ),
    )
  return recent.filter((p) => {
    if (refPattern.test(p.title)) return true
    const meta = (p.rawMetadata ?? {}) as { body?: string | null }
    return !!meta.body && refPattern.test(meta.body)
  })
}

function countCIFailures(pr: PullRequest): number {
  const meta = (pr.rawMetadata ?? {}) as { check_runs?: Array<{ conclusion?: string }> }
  if (!meta.check_runs) return 0
  return meta.check_runs.filter((c) => c.conclusion === 'failure').length
}

async function checkHotfixWithin7d(pr: PullRequest) {
  if (!pr.mergedAt) return false
  const hotfixes = await db
    .select()
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.repoId, pr.repoId),
        eq(pullRequests.state, 'merged'),
        gt(pullRequests.mergedAt, pr.mergedAt),
        lt(pullRequests.mergedAt, addDays(pr.mergedAt, 7)),
      ),
    )
  return hotfixes.some((h) => {
    const meta = (h.rawMetadata ?? {}) as { labels?: Array<{ name: string }> }
    return (meta.labels ?? []).some((l) => /hotfix|urgent|critical/i.test(l.name))
  })
}

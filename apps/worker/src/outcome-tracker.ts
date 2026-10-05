import { eq, and, gte, lte, gt, lt, isNull, isNotNull } from 'drizzle-orm'
import {
  pullRequests,
  prOutcomes,
  prOutcomeTimeline,
  repos,
  teams,
  outcomeCheckQueue,
  notifications,
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
      const checkpointDays = (item.row.checkpointDays ?? 7) as 7 | 14 | 30
      await computeAndStoreOutcome(item.pr, item.repo, checkpointDays)
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
  // Look back 37 days to catch PRs that missed any of the three checkpoints.
  const lower = daysAgo(37)
  const merged = await db
    .select({ id: pullRequests.id, mergedAt: pullRequests.mergedAt })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.state, 'merged'),
        isNotNull(pullRequests.mergedAt),
        gte(pullRequests.mergedAt, lower),
      ),
    )
    .limit(1000)
  for (const m of merged) {
    if (!m.mergedAt) continue
    for (const days of [7, 14, 30] as const) {
      await db
        .insert(outcomeCheckQueue)
        .values({ prId: m.id, checkpointDays: days, runAfter: addDays(m.mergedAt, days) })
        .onConflictDoNothing()
    }
  }
}

export async function computeAndStoreOutcome(pr: PullRequest, repo: Repo, checkpointDays: 7 | 14 | 30 = 7) {
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
        hotfixSignals: outcome.hotfixSignals,
        reworkScore: outcome.reworkScore,
        ...(aiSummary
          ? { aiSummary, aiSummaryGeneratedAt: aiSummaryGeneratedAt ?? new Date() }
          : {}),
        computedAt: new Date(),
      },
    })

  // Compute dollar impact and persist a timeline checkpoint row.
  const [teamRow] = await db
    .select({ avgDevHourlyRateUsd: teams.avgDevHourlyRateUsd })
    .from(teams)
    .where(eq(teams.id, pr.teamId))
    .limit(1)
  const hourlyRate = teamRow?.avgDevHourlyRateUsd ?? 75
  // AI time-saving is only counted at the 7-day checkpoint (first observation).
  const timesSaved = checkpointDays === 7 && pr.aiSource ? 2.0 : 0
  const timeLostRevert = outcome.wasReverted ? 4.0 : 0
  const timeLostDownstreamFix = outcome.downstreamFixCount * 2.0
  const timeLostCIFailure = outcome.ciFailureCount * 0.5
  const timeLostHotfix = outcome.hadHotfixWithin7d ? 3.0 : 0
  const dollarImpact =
    (timesSaved - timeLostRevert - timeLostDownstreamFix - timeLostCIFailure - timeLostHotfix) * hourlyRate

  await db
    .insert(prOutcomeTimeline)
    .values({
      prId: pr.id,
      teamId: pr.teamId,
      checkpointDays,
      reworkScore: outcome.reworkScore,
      wasReverted: outcome.wasReverted,
      ciFailureCount: outcome.ciFailureCount,
      downstreamFixCount: outcome.downstreamFixCount,
      hadHotfix: outcome.hadHotfixWithin7d,
      hotfixSignals: outcome.hotfixSignals,
      dollarImpact,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [prOutcomeTimeline.prId, prOutcomeTimeline.checkpointDays],
      set: {
        reworkScore: outcome.reworkScore,
        wasReverted: outcome.wasReverted,
        ciFailureCount: outcome.ciFailureCount,
        downstreamFixCount: outcome.downstreamFixCount,
        hadHotfix: outcome.hadHotfixWithin7d,
        hotfixSignals: outcome.hotfixSignals,
        dollarImpact,
        computedAt: new Date(),
      },
    })

  if (outcome.reworkScore >= 50) {
    const type = outcome.wasReverted ? 'revert_detected' : 'problem_pr'
    const shortTitle = pr.title.length > 70 ? `${pr.title.slice(0, 70)}…` : pr.title
    await db
      .insert(notifications)
      .values({
        teamId: outcome.teamId,
        type,
        title: outcome.wasReverted
          ? `PR #${pr.githubPrNumber} was reverted`
          : `High-risk PR detected: #${pr.githubPrNumber}`,
        body: outcome.wasReverted
          ? `"${shortTitle}" was reverted. Rework score: ${Math.round(outcome.reworkScore)}/100.`
          : `"${shortTitle}" scored ${Math.round(outcome.reworkScore)}/100 on rework risk.`,
        link: '/outcomes',
        sourceId: pr.id,
      })
      .onConflictDoNothing()
  }
}

async function computeOutcome(pr: PullRequest, _repo: Repo) {
  const revertPr = await findRevertPR(pr)
  const downstreamFixes = await findDownstreamFixPRs(pr)
  const ciFailures = countCIFailures(pr)
  const { hadHotfix, hotfixSignals } = await checkHotfixWithin7d(pr)

  const reworkScore = computeReworkScore({
    wasReverted: !!revertPr,
    downstreamFixCount: downstreamFixes.length,
    ciFailureCount: ciFailures,
    hotfixSignals,
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
    hotfixSignals,
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

async function checkHotfixWithin7d(pr: PullRequest): Promise<{ hadHotfix: boolean; hotfixSignals: string[] }> {
  if (!pr.mergedAt) return { hadHotfix: false, hotfixSignals: [] }
  const signals: string[] = []

  // Signal 1 — Labels on the PR itself
  const meta = (pr.rawMetadata ?? {}) as {
    labels?: Array<{ name: string }>
    reviews?: Array<{ state: string }>
  }
  const hasHotfixLabel = (meta.labels ?? []).some((l) =>
    /hotfix|urgent|critical|emergency/i.test(l.name),
  )
  if (hasHotfixLabel) signals.push('label')

  // Signal 2 — Title keywords
  if (/hotfix|hot.fix|urgent|critical|emergency|patch|revert/i.test(pr.title)) {
    signals.push('title_keyword')
  }

  // Signal 3 — Fast merge: opened and merged within 30 minutes
  if (pr.openedAt) {
    const openToMergeMs = pr.mergedAt.getTime() - pr.openedAt.getTime()
    if (openToMergeMs <= 30 * 60 * 1000) signals.push('fast_merge')
  }

  // Signal 4 — Off-hours merge: outside 9am-6pm UTC on weekdays, or any weekend day
  const mergedHour = pr.mergedAt.getUTCHours()
  const mergedDay = pr.mergedAt.getUTCDay() // 0=Sun, 6=Sat
  const isWeekend = mergedDay === 0 || mergedDay === 6
  const isOffHours = mergedHour < 9 || mergedHour >= 18
  if (isWeekend || isOffHours) signals.push('off_hours')

  // Signal 5 — Zero review fast merge: no reviews AND merged within 2 hours
  const reviewCount = pr.reviewCount ?? 0
  const changesRequestedCount = pr.changesRequestedCount ?? 0
  if (pr.openedAt) {
    const openToMergeMs = pr.mergedAt.getTime() - pr.openedAt.getTime()
    if (reviewCount === 0 && changesRequestedCount === 0 && openToMergeMs <= 2 * 60 * 60 * 1000) {
      signals.push('zero_review_fast')
    }
  }

  return { hadHotfix: signals.length > 0, hotfixSignals: signals }
}

import { eq, and, gte, lt, isNotNull } from 'drizzle-orm'
import { teams, pullRequests, prOutcomes, teamWeeklyMetrics } from '@grassion/db'
import { db } from './db.js'
import { logger } from './logger.js'
import { addDays, hoursBetween, startOfWeekUtc, type Verdict } from '@grassion/shared'

/**
 * Computes and caches weekly metrics for a single team.
 * Idempotent — re-running for the same week overwrites the cache row.
 */
export async function computeWeeklyMetricsForTeam(teamId: string, weekStart: Date) {
  const weekEnd = addDays(weekStart, 7)

  const prs = await db
    .select({ pr: pullRequests, outcome: prOutcomes })
    .from(pullRequests)
    .leftJoin(prOutcomes, eq(prOutcomes.prId, pullRequests.id))
    .where(
      and(
        eq(pullRequests.teamId, teamId),
        eq(pullRequests.state, 'merged'),
        gte(pullRequests.mergedAt, weekStart),
        lt(pullRequests.mergedAt, weekEnd),
        isNotNull(pullRequests.mergedAt),
      ),
    )

  const aiPrs = prs.filter((p) => !!p.pr.aiSource)
  const humanPrs = prs.filter((p) => !p.pr.aiSource)

  const aiAvgMergeHours = avg(aiPrs.map((p) => hoursBetween(p.pr.openedAt, p.pr.mergedAt!)))
  const humanAvgMergeHours = avg(humanPrs.map((p) => hoursBetween(p.pr.openedAt, p.pr.mergedAt!)))

  const aiReworkRate = rateOfRework(aiPrs)
  const humanReworkRate = rateOfRework(humanPrs)

  const team = (await db.select().from(teams).where(eq(teams.id, teamId)).limit(1))[0]
  const rate = team?.avgDevHourlyRateUsd ?? 75
  const spend = team?.monthlyAiSpendUsd ?? 0

  // Hours saved: if AI merges faster, the time delta × count = saved time.
  // 0.3 dampener — merge speed ≠ dev time saved 1:1.
  const speedDeltaHours = Math.max(0, humanAvgMergeHours - aiAvgMergeHours)
  const estimatedHoursSaved = speedDeltaHours * aiPrs.length * 0.3

  // Hours lost: rework PRs take an estimated 3 hours per incident.
  const reworkPrs = aiPrs.filter((p) => (p.outcome?.reworkScore ?? 0) > 30)
  const estimatedHoursLost = reworkPrs.length * 3

  const estimatedDollarSaved = estimatedHoursSaved * rate
  const estimatedDollarLost = estimatedHoursLost * rate + spend / 4 // weekly share of monthly AI spend

  const netDollar = estimatedDollarSaved - estimatedDollarLost

  const verdict: Verdict =
    prs.length < 5
      ? 'insufficient_data'
      : netDollar > 100
        ? 'net_positive'
        : netDollar < -100
          ? 'net_negative'
          : 'unclear'

  await db
    .insert(teamWeeklyMetrics)
    .values({
      teamId,
      weekStart,
      totalPrs: prs.length,
      aiPrs: aiPrs.length,
      humanPrs: humanPrs.length,
      aiAvgMergeHours: aiPrs.length ? aiAvgMergeHours : null,
      humanAvgMergeHours: humanPrs.length ? humanAvgMergeHours : null,
      aiReworkRate: aiPrs.length ? aiReworkRate : null,
      humanReworkRate: humanPrs.length ? humanReworkRate : null,
      estimatedHoursSaved,
      estimatedHoursLost,
      estimatedDollarSaved,
      estimatedDollarLost,
      verdict,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [teamWeeklyMetrics.teamId, teamWeeklyMetrics.weekStart],
      set: {
        totalPrs: prs.length,
        aiPrs: aiPrs.length,
        humanPrs: humanPrs.length,
        aiAvgMergeHours: aiPrs.length ? aiAvgMergeHours : null,
        humanAvgMergeHours: humanPrs.length ? humanAvgMergeHours : null,
        aiReworkRate: aiPrs.length ? aiReworkRate : null,
        humanReworkRate: humanPrs.length ? humanReworkRate : null,
        estimatedHoursSaved,
        estimatedHoursLost,
        estimatedDollarSaved,
        estimatedDollarLost,
        verdict,
        computedAt: new Date(),
      },
    })

  return {
    teamId,
    weekStart,
    totalPrs: prs.length,
    aiPrs: aiPrs.length,
    humanPrs: humanPrs.length,
    aiAvgMergeHours,
    humanAvgMergeHours,
    aiReworkRate,
    humanReworkRate,
    estimatedHoursSaved,
    estimatedHoursLost,
    estimatedDollarSaved,
    estimatedDollarLost,
    netDollar,
    verdict,
  }
}

export async function computeWeeklyMetricsForAllTeams(weekStart: Date = startOfWeekUtc()) {
  const allTeams = await db.select({ id: teams.id }).from(teams)
  let ok = 0
  let failed = 0
  for (const t of allTeams) {
    try {
      await computeWeeklyMetricsForTeam(t.id, weekStart)
      ok++
    } catch (err) {
      failed++
      logger.error({ err, teamId: t.id }, 'weekly metrics computation failed')
    }
  }
  logger.info({ ok, failed }, 'weekly metrics computation done')
}

function rateOfRework(prs: Array<{ outcome?: { reworkScore?: number | null } | null }>): number {
  if (prs.length === 0) return 0
  const reworked = prs.filter((p) => (p.outcome?.reworkScore ?? 0) > 30)
  return reworked.length / prs.length
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

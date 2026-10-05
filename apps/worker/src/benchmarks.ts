import {
  industryBenchmarks,
  teamBenchmarkContributions,
  weeklySnapshots,
  teams,
  pullRequests,
  sql,
  eq,
  and,
  gte,
  inArray,
} from '@grassion/db'
import { db } from './db.js'
import { logger } from './logger.js'

const MIN_OPT_IN_TEAMS = 10
const MIN_AI_PRS_PER_TEAM = 5

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower] ?? 0
  return (sorted[lower] ?? 0) * (upper - idx) + (sorted[upper] ?? 0) * (idx - lower)
}

export async function computeBenchmarks(): Promise<void> {
  const optInTeams = await db
    .select({ id: teams.id, teamSizeRange: teams.teamSizeRange, industry: teams.industry })
    .from(teams)
    .where(eq(teams.benchmarkingOptIn, true))

  if (optInTeams.length < MIN_OPT_IN_TEAMS) {
    logger.info({ optInCount: optInTeams.length }, 'benchmarks: need 10+ opt-in teams, skipping')
    return
  }

  const teamIds = optInTeams.map((t) => t.id)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  const [prStats, snapshots] = await Promise.all([
    db
      .select({
        teamId: pullRequests.teamId,
        totalMerged: sql<number>`COUNT(*)::int`,
        aiPrs: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL)::int`,
        revertedAiPrs: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.wasReverted} = true AND ${pullRequests.aiSource} IS NOT NULL)::int`,
        hotfixAiPrs: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.triggeredHotfix} = true AND ${pullRequests.aiSource} IS NOT NULL)::int`,
      })
      .from(pullRequests)
      .where(
        and(
          inArray(pullRequests.teamId, teamIds),
          eq(pullRequests.state, 'merged'),
          gte(pullRequests.mergedAt, ninetyDaysAgo),
        ),
      )
      .groupBy(pullRequests.teamId),

    db
      .select({
        teamId: weeklySnapshots.teamId,
        totalSeats: weeklySnapshots.totalSeats,
        netRoiUsd: weeklySnapshots.netRoiUsd,
        weekStart: weeklySnapshots.weekStart,
      })
      .from(weeklySnapshots)
      .where(and(inArray(weeklySnapshots.teamId, teamIds), gte(weeklySnapshots.weekStart, ninetyDaysAgo))),
  ])

  type TeamMetric = {
    teamId: string
    revertRate: number
    hotfixRate: number
    adoptionPct: number
    roiPerSeat: number
  }

  const teamMetrics: TeamMetric[] = []
  for (const team of optInTeams) {
    const stat = prStats.find((s) => s.teamId === team.id)
    if (!stat || (stat.aiPrs ?? 0) < MIN_AI_PRS_PER_TEAM) continue

    const aiPrs = stat.aiPrs ?? 0
    const revertRate = aiPrs > 0 ? (stat.revertedAiPrs ?? 0) / aiPrs : 0
    const hotfixRate = aiPrs > 0 ? (stat.hotfixAiPrs ?? 0) / aiPrs : 0
    const adoptionPct = (stat.totalMerged ?? 0) > 0 ? aiPrs / (stat.totalMerged ?? 1) : 0

    const teamSnaps = snapshots
      .filter((s) => s.teamId === team.id)
      .sort((a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime())
    const latestSeats = teamSnaps[0]?.totalSeats ?? 1
    const avgNetRoi = teamSnaps.length > 0
      ? teamSnaps.reduce((sum, s) => sum + (s.netRoiUsd ?? 0), 0) / teamSnaps.length
      : 0
    const roiPerSeat = latestSeats > 0 ? avgNetRoi / latestSeats : 0

    teamMetrics.push({ teamId: team.id, revertRate, hotfixRate, adoptionPct, roiPerSeat })
  }

  if (teamMetrics.length < MIN_OPT_IN_TEAMS) {
    logger.info({ computed: teamMetrics.length }, 'benchmarks: fewer than 10 teams with sufficient PR data, skipping')
    return
  }

  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  const metricDefs: Array<{ name: string; values: number[] }> = [
    { name: 'revert_rate',      values: [...teamMetrics.map((t) => t.revertRate)].sort((a, b) => a - b) },
    { name: 'hotfix_rate',      values: [...teamMetrics.map((t) => t.hotfixRate)].sort((a, b) => a - b) },
    { name: 'adoption_pct',     values: [...teamMetrics.map((t) => t.adoptionPct)].sort((a, b) => a - b) },
    { name: 'roi_usd_per_seat', values: [...teamMetrics.map((t) => t.roiPerSeat)].sort((a, b) => a - b) },
  ]

  const benchmarkRows = metricDefs.map(({ name, values }) => ({
    toolName: 'all',
    teamSizeRange: 'all',
    industry: 'all',
    metricName: name,
    p25Value: percentile(values, 25),
    p50Value: percentile(values, 50),
    p75Value: percentile(values, 75),
    sampleSize: values.length,
    validUntil,
  }))

  const inserted = await db
    .insert(industryBenchmarks)
    .values(benchmarkRows)
    .returning({ id: industryBenchmarks.id, metricName: industryBenchmarks.metricName })

  if (inserted.length > 0) {
    const contributions = teamMetrics.flatMap((tm) =>
      inserted.map((b) => ({ teamId: tm.teamId, benchmarkId: b.id })),
    )
    await db.insert(teamBenchmarkContributions).values(contributions).onConflictDoNothing()
  }

  logger.info({ benchmarks: inserted.length, teams: teamMetrics.length }, 'industry benchmarks recomputed')
}

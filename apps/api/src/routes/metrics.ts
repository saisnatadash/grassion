import { Router, type Request, type Response } from 'express'
import { eq, and, gte, lt, desc, isNotNull, sql } from 'drizzle-orm'
import { teams, teamWeeklyMetrics, pullRequests, prOutcomes, repos, users } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { startOfWeekUtc, addDays } from '@grassion/shared'

async function freshTeamId(githubLogin: string, fallback: string): Promise<string> {
  const row = await db.select({ teamId: users.teamId }).from(users).where(eq(users.githubLogin, githubLogin)).limit(1)
  return row[0]?.teamId ?? fallback
}

export const metricsRouter = Router()

metricsRouter.get('/api/metrics/summary', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const teamId = await freshTeamId(sess.githubLogin, sess.teamId)
  console.log('[metrics/summary] githubLogin:', sess.githubLogin, 'sessionTeamId:', sess.teamId, 'freshTeamId:', teamId)
  const team = (await db.select().from(teams).where(eq(teams.id, teamId)).limit(1))[0]
  if (!team) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  const weekStart = startOfWeekUtc()
  const cached = (
    await db
      .select()
      .from(teamWeeklyMetrics)
      .where(and(eq(teamWeeklyMetrics.teamId, teamId), eq(teamWeeklyMetrics.weekStart, weekStart)))
      .limit(1)
  )[0]

  if (cached && cached.totalPrs && cached.totalPrs > 0) {
    res.json(toSummary(cached, team.monthlyAiSpendUsd ?? 0))
    return
  }

  // Fall back to live computation if cache empty.
  const live = await liveSummary(teamId, weekStart)
  res.json({ ...live, monthlySpend: team.monthlyAiSpendUsd ?? 0 })
})

metricsRouter.get('/api/metrics/weekly', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const teamId = await freshTeamId(sess.githubLogin, sess.teamId)
  console.log('[metrics/weekly] githubLogin:', sess.githubLogin, 'sessionTeamId:', sess.teamId, 'freshTeamId:', teamId)

  try {
    const twelveWeeksAgo = new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000)

    // Query directly from pull_requests using DATE_TRUNC for exact grouping
    const liveRows = await db
      .select({
        weekStart: sql<string>`DATE_TRUNC('week', ${pullRequests.mergedAt})::date::text`,
        totalPrs: sql<number>`COUNT(*)::int`,
        aiPrs: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL)::int`,
      })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.teamId, teamId),
          gte(pullRequests.mergedAt, twelveWeeksAgo),
          eq(pullRequests.state, 'merged'),
          isNotNull(pullRequests.mergedAt),
        ),
      )
      .groupBy(sql`DATE_TRUNC('week', ${pullRequests.mergedAt})`)
      .orderBy(sql`DATE_TRUNC('week', ${pullRequests.mergedAt}) ASC`)

    console.log('[metrics/weekly] DB rows:', liveRows.length, JSON.stringify(liveRows))

    // Build 12-week Monday-aligned grid matching frontend expectations
    const now = new Date()
    const dayOfWeek = now.getUTCDay()
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const thisMonday = new Date(now)
    thisMonday.setUTCDate(now.getUTCDate() + daysToMonday)
    thisMonday.setUTCHours(0, 0, 0, 0)

    const byKey = new Map(liveRows.map((r) => [r.weekStart, r]))

    const out: Array<{
      weekStart: string
      totalPrs: number
      aiPrs: number
      humanPrs: number
      aiAvgMergeHours: null
      humanAvgMergeHours: null
      aiReworkRate: null
      humanReworkRate: null
      estimatedDollarSaved: number
      estimatedDollarLost: number
      netDollar: number
      verdict: string
    }> = []

    for (let i = 11; i >= 0; i--) {
      const weekDate = new Date(thisMonday)
      weekDate.setUTCDate(thisMonday.getUTCDate() - i * 7)
      const isoDate = weekDate.toISOString().slice(0, 10)
      const row = byKey.get(isoDate)
      const totalPrs = row?.totalPrs ?? 0
      const aiPrs = row?.aiPrs ?? 0
      out.push({
        weekStart: weekDate.toISOString(),
        totalPrs,
        aiPrs,
        humanPrs: totalPrs - aiPrs,
        aiAvgMergeHours: null,
        humanAvgMergeHours: null,
        aiReworkRate: null,
        humanReworkRate: null,
        estimatedDollarSaved: 0,
        estimatedDollarLost: 0,
        netDollar: 0,
        verdict: totalPrs < 5 ? 'insufficient_data' : aiPrs > 5 ? 'positive' : 'unclear',
      })
    }

    res.json(out)
  } catch (err) {
    console.error('[metrics/weekly]', err)
    res.status(500).json({ error: 'internal_error' })
  }
})

function toSummary(row: typeof teamWeeklyMetrics.$inferSelect, monthlySpend: number) {
  const aiAvg = row.aiAvgMergeHours ?? 0
  const humanAvg = row.humanAvgMergeHours ?? 0
  const speedDeltaPercent =
    humanAvg > 0 ? Math.round(((humanAvg - aiAvg) / humanAvg) * 100) : 0
  const aiRework = row.aiReworkRate ?? 0
  const humanRework = row.humanReworkRate ?? 0
  const reworkMultiplier = humanRework > 0 ? Number((aiRework / humanRework).toFixed(2)) : aiRework > 0 ? 99 : 1
  const saved = row.estimatedDollarSaved ?? 0
  const lost = row.estimatedDollarLost ?? 0
  return {
    weekStart: row.weekStart.toISOString(),
    totalPrs: row.totalPrs ?? 0,
    aiPrs: row.aiPrs ?? 0,
    humanPrs: row.humanPrs ?? 0,
    speedDeltaPercent,
    reworkMultiplier,
    monthlySpend,
    estimatedDollarSaved: saved,
    estimatedDollarLost: lost,
    netDollar: saved - lost,
    verdict: row.verdict ?? 'insufficient_data',
  }
}

async function liveSummary(teamId: string, weekStart: Date) {
  const weekEnd = addDays(weekStart, 7)
  const merged = await db
    .select()
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.teamId, teamId),
        eq(pullRequests.state, 'merged'),
        gte(pullRequests.mergedAt, weekStart),
        lt(pullRequests.mergedAt, weekEnd),
        isNotNull(pullRequests.mergedAt),
      ),
    )
  const totalPrs = merged.length
  const aiPrs = merged.filter((p) => !!p.aiSource).length
  return {
    weekStart: weekStart.toISOString(),
    totalPrs,
    aiPrs,
    humanPrs: totalPrs - aiPrs,
    speedDeltaPercent: 0,
    reworkMultiplier: 1,
    estimatedDollarSaved: 0,
    estimatedDollarLost: 0,
    netDollar: 0,
    verdict: totalPrs < 5 ? 'insufficient_data' : aiPrs > 5 ? 'positive' : 'unclear',
  }
}

metricsRouter.get('/api/prs/problem', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const rows = await db
    .select({
      pr: pullRequests,
      outcome: prOutcomes,
      repo: repos,
    })
    .from(pullRequests)
    .innerJoin(prOutcomes, eq(prOutcomes.prId, pullRequests.id))
    .innerJoin(repos, eq(repos.id, pullRequests.repoId))
    .where(and(eq(pullRequests.teamId, sess.teamId), gte(prOutcomes.reworkScore, 30)))
    .orderBy(desc(prOutcomes.reworkScore))
    .limit(20)

  res.json(
    rows.map(({ pr, outcome, repo }) => ({
      id: pr.id,
      number: pr.githubPrNumber,
      title: pr.title,
      url: `https://github.com/${repo.owner}/${repo.name}/pull/${pr.githubPrNumber}`,
      reason: reasonFor(outcome),
      aiSummary: outcome.aiSummary ?? null,
      reworkScore: outcome.reworkScore ?? 0,
      aiSource: pr.aiSource,
      mergedAt: pr.mergedAt?.toISOString() ?? null,
    })),
  )
})

metricsRouter.get('/api/prs/:id', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const id = req.params.id
  if (!id) {
    res.status(400).json({ error: 'missing_id' })
    return
  }
  const row = (
    await db
      .select({ pr: pullRequests, outcome: prOutcomes, repo: repos })
      .from(pullRequests)
      .leftJoin(prOutcomes, eq(prOutcomes.prId, pullRequests.id))
      .innerJoin(repos, eq(repos.id, pullRequests.repoId))
      .where(and(eq(pullRequests.id, id), eq(pullRequests.teamId, sess.teamId)))
      .limit(1)
  )[0]
  if (!row) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  res.json({
    id: row.pr.id,
    number: row.pr.githubPrNumber,
    title: row.pr.title,
    state: row.pr.state,
    aiSource: row.pr.aiSource,
    aiDetectionMethod: row.pr.aiDetectionMethod,
    aiConfidence: row.pr.aiConfidence,
    openedAt: row.pr.openedAt.toISOString(),
    mergedAt: row.pr.mergedAt?.toISOString() ?? null,
    closedAt: row.pr.closedAt?.toISOString() ?? null,
    additions: row.pr.additions,
    deletions: row.pr.deletions,
    changedFiles: row.pr.changedFiles,
    repo: { owner: row.repo.owner, name: row.repo.name },
    url: `https://github.com/${row.repo.owner}/${row.repo.name}/pull/${row.pr.githubPrNumber}`,
    outcome: row.outcome
      ? {
          wasReverted: row.outcome.wasReverted,
          revertedAt: row.outcome.revertedAt?.toISOString() ?? null,
          revertPrNumber: row.outcome.revertPrNumber,
          ciFailureCount: row.outcome.ciFailureCount,
          downstreamFixCount: row.outcome.downstreamFixCount,
          downstreamFixPrNumbers: row.outcome.downstreamFixPrNumbers ?? [],
          hadHotfixWithin7d: row.outcome.hadHotfixWithin7d,
          reworkScore: row.outcome.reworkScore,
          computedAt: row.outcome.computedAt.toISOString(),
        }
      : null,
  })
})

function reasonFor(o: typeof prOutcomes.$inferSelect): string {
  const parts: string[] = []
  if (o.wasReverted) parts.push(`reverted in #${o.revertPrNumber ?? '?'}`)
  if ((o.downstreamFixCount ?? 0) > 0) parts.push(`${o.downstreamFixCount} downstream fix(es)`)
  if ((o.ciFailureCount ?? 0) > 0) parts.push(`${o.ciFailureCount} CI failure(s)`)
  if (o.hadHotfixWithin7d) parts.push('hotfix within 7d')
  return parts.join(', ') || 'high rework score'
}

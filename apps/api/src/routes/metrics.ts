import { Router, type Request, type Response } from 'express'
import { eq, and, gte, lt, desc, isNotNull } from 'drizzle-orm'
import { teams, teamWeeklyMetrics, pullRequests, prOutcomes, repos } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { startOfWeekUtc, addDays, lastNWeeks } from '@grassion/shared'

export const metricsRouter = Router()

metricsRouter.get('/api/metrics/summary', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const team = (await db.select().from(teams).where(eq(teams.id, sess.teamId)).limit(1))[0]
  if (!team) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  const weekStart = startOfWeekUtc()
  const cached = (
    await db
      .select()
      .from(teamWeeklyMetrics)
      .where(and(eq(teamWeeklyMetrics.teamId, sess.teamId), eq(teamWeeklyMetrics.weekStart, weekStart)))
      .limit(1)
  )[0]

  if (cached && cached.totalPrs && cached.totalPrs > 0) {
    res.json(toSummary(cached, team.monthlyAiSpendUsd ?? 0))
    return
  }

  // Fall back to live computation if cache empty.
  const live = await liveSummary(sess.teamId, weekStart)
  res.json({ ...live, monthlySpend: team.monthlyAiSpendUsd ?? 0 })
})

metricsRouter.get('/api/metrics/weekly', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const weeks = lastNWeeks(12)
  const oldest = weeks[0]!
  const rows = await db
    .select()
    .from(teamWeeklyMetrics)
    .where(and(eq(teamWeeklyMetrics.teamId, sess.teamId), gte(teamWeeklyMetrics.weekStart, oldest)))
    .orderBy(teamWeeklyMetrics.weekStart)
  const byKey = new Map(rows.map((r) => [r.weekStart.toISOString(), r]))
  const out = weeks.map((w) => {
    const row = byKey.get(w.toISOString())
    return {
      weekStart: w.toISOString(),
      totalPrs: row?.totalPrs ?? 0,
      aiPrs: row?.aiPrs ?? 0,
      humanPrs: row?.humanPrs ?? 0,
      aiAvgMergeHours: row?.aiAvgMergeHours ?? null,
      humanAvgMergeHours: row?.humanAvgMergeHours ?? null,
      aiReworkRate: row?.aiReworkRate ?? null,
      humanReworkRate: row?.humanReworkRate ?? null,
      estimatedDollarSaved: row?.estimatedDollarSaved ?? 0,
      estimatedDollarLost: row?.estimatedDollarLost ?? 0,
      netDollar: (row?.estimatedDollarSaved ?? 0) - (row?.estimatedDollarLost ?? 0),
      verdict: row?.verdict ?? 'insufficient_data',
    }
  })
  res.json(out)
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
    verdict: totalPrs < 5 ? 'insufficient_data' : 'unclear',
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

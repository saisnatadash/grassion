import { Router, type Request, type Response } from 'express'
import { eq, and, gte, lt, desc, isNotNull, sql } from 'drizzle-orm'
import { teams, teamWeeklyMetrics, pullRequests, prOutcomes, repos, users, weeklySnapshots } from '@grassion/db'

async function populateWeeklyMetrics(teamId: string, weekStart: Date): Promise<void> {
  const weekStartStr = weekStart.toISOString().split('T')[0]!

  await db.execute(sql`
    INSERT INTO developer_weekly_metrics (
      team_id, github_login, week_start, total_prs, ai_prs,
      reverted_prs, hotfix_prs, quality_score, is_active, primary_ai_tool
    )
    SELECT
      ${teamId}::uuid,
      author_login,
      ${weekStartStr}::date,
      COUNT(*)::int,
      COUNT(*) FILTER (WHERE ai_source IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE was_reverted = true)::int,
      COUNT(*) FILTER (WHERE triggered_hotfix = true)::int,
      GREATEST(0, 100
        - (AVG(CASE WHEN was_reverted THEN 1.0 ELSE 0 END) * 40)
        - (AVG(CASE WHEN triggered_hotfix THEN 1.0 ELSE 0 END) * 30)
      ),
      (COUNT(*) FILTER (WHERE ai_source IS NOT NULL)) > 0,
      MODE() WITHIN GROUP (ORDER BY ai_source) FILTER (WHERE ai_source IS NOT NULL)
    FROM pull_requests
    WHERE team_id = ${teamId}::uuid
      AND merged_at >= ${weekStart}
      AND state = 'merged'
      AND author_login IS NOT NULL
    GROUP BY author_login
    ON CONFLICT (team_id, github_login, week_start)
    DO UPDATE SET
      total_prs = EXCLUDED.total_prs,
      ai_prs = EXCLUDED.ai_prs,
      reverted_prs = EXCLUDED.reverted_prs,
      hotfix_prs = EXCLUDED.hotfix_prs,
      quality_score = EXCLUDED.quality_score,
      is_active = EXCLUDED.is_active,
      primary_ai_tool = EXCLUDED.primary_ai_tool,
      recorded_at = now()
  `)

  await db.execute(sql`
    INSERT INTO tool_weekly_metrics (
      team_id, tool_name, week_start, pr_count, revert_count,
      quality_score, active_users
    )
    SELECT
      ${teamId}::uuid,
      ai_source,
      ${weekStartStr}::date,
      COUNT(*)::int,
      COUNT(*) FILTER (WHERE was_reverted = true)::int,
      GREATEST(0, 100 - (
        COUNT(*) FILTER (WHERE was_reverted = true)::float / NULLIF(COUNT(*), 0) * 40
      )),
      COUNT(DISTINCT author_login)::int
    FROM pull_requests
    WHERE team_id = ${teamId}::uuid
      AND ai_source IS NOT NULL
      AND merged_at >= ${weekStart}
      AND state = 'merged'
    GROUP BY ai_source
    ON CONFLICT (team_id, tool_name, week_start)
    DO UPDATE SET
      pr_count = EXCLUDED.pr_count,
      revert_count = EXCLUDED.revert_count,
      quality_score = EXCLUDED.quality_score,
      active_users = EXCLUDED.active_users,
      recorded_at = now()
  `)

  await db.execute(sql`
    INSERT INTO codebase_health_snapshots (
      team_id, snapshot_date, overall_health_score,
      ai_adoption_pct, revert_rate_pct, hotfix_rate_pct,
      active_developers, total_developers, risk_level
    )
    WITH stats AS (
      SELECT
        COUNT(*) FILTER (WHERE ai_source IS NOT NULL)::float AS ai_prs,
        COUNT(*)::float AS total_prs,
        COUNT(*) FILTER (WHERE was_reverted = true AND ai_source IS NOT NULL)::float AS reverted,
        COUNT(*) FILTER (WHERE triggered_hotfix = true AND ai_source IS NOT NULL)::float AS hotfix,
        COUNT(DISTINCT author_login) FILTER (WHERE merged_at >= ${weekStart})::int AS active_devs,
        COUNT(DISTINCT author_login)::int AS total_devs
      FROM pull_requests
      WHERE team_id = ${teamId}::uuid AND state = 'merged'
    ),
    rates AS (
      SELECT
        CASE WHEN ai_prs > 0 THEN reverted / ai_prs * 100 ELSE 0 END AS revert_rate,
        CASE WHEN ai_prs > 0 THEN hotfix / ai_prs * 100 ELSE 0 END AS hotfix_rate,
        CASE WHEN total_prs > 0 THEN ai_prs / total_prs * 100 ELSE 0 END AS adoption_pct,
        active_devs, total_devs
      FROM stats
    )
    SELECT
      ${teamId}::uuid,
      ${weekStartStr}::date,
      GREATEST(0, 100 - revert_rate * 0.4 - hotfix_rate * 0.3),
      adoption_pct,
      revert_rate,
      hotfix_rate,
      active_devs,
      total_devs,
      CASE
        WHEN revert_rate > 15 OR hotfix_rate > 20 THEN 'high'
        WHEN revert_rate > 8 OR hotfix_rate > 10 THEN 'medium'
        ELSE 'low'
      END
    FROM rates
    ON CONFLICT (team_id, snapshot_date)
    DO UPDATE SET
      overall_health_score = EXCLUDED.overall_health_score,
      ai_adoption_pct = EXCLUDED.ai_adoption_pct,
      revert_rate_pct = EXCLUDED.revert_rate_pct,
      hotfix_rate_pct = EXCLUDED.hotfix_rate_pct,
      active_developers = EXCLUDED.active_developers,
      total_developers = EXCLUDED.total_developers,
      risk_level = EXCLUDED.risk_level
  `)
}
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { startOfWeekUtc, addDays } from '@grassion/shared'

async function freshTeamId(githubLogin: string, fallback: string): Promise<string> {
  const row = await db.select({ teamId: users.teamId }).from(users).where(eq(users.githubLogin, githubLogin)).limit(1)
  return row[0]?.teamId ?? fallback
}

export const metricsRouter = Router()

async function snapshotWeek(
  teamId: string,
  weekStart: Date,
  data: { aiPrs: number; totalPrs: number; netDollar: number; verdict: string },
) {
  const adoptionPct = data.totalPrs > 0 ? data.aiPrs / data.totalPrs : 0
  await db
    .insert(weeklySnapshots)
    .values({
      teamId,
      weekStart,
      aiPrs: data.aiPrs,
      totalPrs: data.totalPrs,
      aiAdoptionPct: adoptionPct,
      netRoiUsd: data.netDollar,
      verdict: data.verdict,
    })
    .onConflictDoUpdate({
      target: [weeklySnapshots.teamId, weeklySnapshots.weekStart],
      set: {
        aiPrs: data.aiPrs,
        totalPrs: data.totalPrs,
        aiAdoptionPct: adoptionPct,
        netRoiUsd: data.netDollar,
        verdict: data.verdict,
        computedAt: new Date(),
      },
    })
}

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
    const summary = toSummary(cached, team.monthlyAiSpendUsd ?? 0)
    snapshotWeek(teamId, weekStart, summary).catch((e: Error) =>
      console.warn('[summary] snapshot skipped:', e.message),
    )
    populateWeeklyMetrics(teamId, weekStart).catch((e: Error) =>
      console.warn('[summary] metrics populate skipped:', e.message),
    )
    res.json(summary)
    return
  }

  // Fall back to live computation if cache empty.
  const live = await liveSummary(
    teamId,
    weekStart,
    team.avgDevHourlyRateUsd ?? 75,
    team.monthlyAiSpendUsd ?? 30,
  )
  const liveResponse = { ...live, monthlySpend: team.monthlyAiSpendUsd ?? 0 }
  snapshotWeek(teamId, weekStart, live).catch((e: Error) =>
    console.warn('[summary] snapshot skipped:', e.message),
  )
  populateWeeklyMetrics(teamId, weekStart).catch((e: Error) =>
    console.warn('[summary] metrics populate skipped:', e.message),
  )
  res.json(liveResponse)
})

metricsRouter.get('/api/metrics/history', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const teamId = await freshTeamId(sess.githubLogin, sess.teamId)
  try {
    const rows = await db
      .select()
      .from(weeklySnapshots)
      .where(eq(weeklySnapshots.teamId, teamId))
      .orderBy(desc(weeklySnapshots.weekStart))
      .limit(12)
    res.json(
      rows.map((r) => ({
        weekStart: r.weekStart.toISOString(),
        totalSeats: r.totalSeats ?? 0,
        activeSeats: r.activeSeats ?? 0,
        inactiveSeats: r.inactiveSeats ?? 0,
        aiPrs: r.aiPrs ?? 0,
        totalPrs: r.totalPrs ?? 0,
        aiAdoptionPct: r.aiAdoptionPct ?? 0,
        monthlyWasteUsd: r.monthlyWasteUsd ?? 0,
        netRoiUsd: r.netRoiUsd ?? 0,
        verdict: r.verdict ?? 'insufficient_data',
      })),
    )
  } catch (err) {
    console.error('[metrics/history]', err)
    res.json([])
  }
})

metricsRouter.get('/api/metrics/weekly', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const teamId = await freshTeamId(sess.githubLogin, sess.teamId)
  console.log('[metrics/weekly] githubLogin:', sess.githubLogin, 'sessionTeamId:', sess.teamId, 'freshTeamId:', teamId)

  try {
    const eightWeeksAgo = new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000)

    const teamRow = (
      await db
        .select({ avgDevHourlyRateUsd: teams.avgDevHourlyRateUsd, monthlyAiSpendUsd: teams.monthlyAiSpendUsd })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1)
    )[0]
    const hourlyRate = teamRow?.avgDevHourlyRateUsd ?? 75
    const monthlySpend = teamRow?.monthlyAiSpendUsd ?? 30

    // Count merged PRs grouped by ISO week
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
          gte(pullRequests.mergedAt, eightWeeksAgo),
          eq(pullRequests.state, 'merged'),
          isNotNull(pullRequests.mergedAt),
        ),
      )
      .groupBy(sql`DATE_TRUNC('week', ${pullRequests.mergedAt})`)
      .orderBy(sql`DATE_TRUNC('week', ${pullRequests.mergedAt}) ASC`)

    console.log('[metrics/weekly] DB rows:', liveRows.length, JSON.stringify(liveRows))

    // Build 6-week Monday-aligned grid; fills zeros for weeks with no merged PRs
    const now = new Date()
    const dayOfWeek = now.getUTCDay()
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const thisMonday = new Date(now)
    thisMonday.setUTCDate(now.getUTCDate() + daysToMonday)
    thisMonday.setUTCHours(0, 0, 0, 0)

    // No real PR data — return sample data so chart shows something during onboarding/demo
    if (liveRows.length === 0) {
      const sampleAiPrs = [1, 2, 3, 2, 4, 3]
      const sample = sampleAiPrs.map((aiPrs, idx) => {
        const weekDate = new Date(thisMonday)
        weekDate.setUTCDate(thisMonday.getUTCDate() - (5 - idx) * 7)
        const totalPrs = aiPrs + Math.ceil(aiPrs * 0.5)
        const estimatedDollarSaved = aiPrs * hourlyRate * 2
        const netDollar = estimatedDollarSaved - monthlySpend
        return {
          weekStart: weekDate.toISOString(),
          totalPrs,
          aiPrs,
          humanPrs: totalPrs - aiPrs,
          aiAvgMergeHours: null,
          humanAvgMergeHours: null,
          aiReworkRate: null,
          humanReworkRate: null,
          estimatedDollarSaved,
          estimatedDollarLost: monthlySpend,
          netDollar,
          verdict: netDollar > 0 ? 'net_positive' : 'net_negative',
        }
      })
      console.log('[metrics/weekly] no real data, returning sample')
      res.json(sample)
      return
    }

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

    for (let i = 5; i >= 0; i--) {
      const weekDate = new Date(thisMonday)
      weekDate.setUTCDate(thisMonday.getUTCDate() - i * 7)
      const isoDate = weekDate.toISOString().slice(0, 10)
      const row = byKey.get(isoDate)
      const totalPrs = row?.totalPrs ?? 0
      const aiPrs = row?.aiPrs ?? 0
      const estimatedDollarSaved = aiPrs * hourlyRate * 2
      const netDollar = estimatedDollarSaved - monthlySpend
      const verdict =
        totalPrs < 5
          ? 'insufficient_data'
          : netDollar > 0
            ? 'net_positive'
            : netDollar < 0
              ? 'net_negative'
              : 'unclear'
      out.push({
        weekStart: weekDate.toISOString(),
        totalPrs,
        aiPrs,
        humanPrs: totalPrs - aiPrs,
        aiAvgMergeHours: null,
        humanAvgMergeHours: null,
        aiReworkRate: null,
        humanReworkRate: null,
        estimatedDollarSaved,
        estimatedDollarLost: monthlySpend,
        netDollar,
        verdict,
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

async function liveSummary(
  teamId: string,
  weekStart: Date,
  avgDevHourlyRateUsd: number,
  monthlyAiSpendUsd: number,
) {
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
  const estimatedDollarSaved = aiPrs * avgDevHourlyRateUsd * 2
  const netDollar = estimatedDollarSaved - monthlyAiSpendUsd
  const verdict =
    totalPrs < 5
      ? 'insufficient_data'
      : netDollar > 0
        ? 'net_positive'
        : netDollar < 0
          ? 'net_negative'
          : 'unclear'
  return {
    weekStart: weekStart.toISOString(),
    totalPrs,
    aiPrs,
    humanPrs: totalPrs - aiPrs,
    speedDeltaPercent: 0,
    reworkMultiplier: 1,
    estimatedDollarSaved,
    estimatedDollarLost: monthlyAiSpendUsd,
    netDollar,
    verdict,
  }
}

metricsRouter.get('/api/prs/problem', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const teamId = await freshTeamId(sess.githubLogin, sess.teamId)

  try {
    // Tier 1: PRs with computed outcome scores ≥ 30
    const outcomeRows = await db
      .select({ pr: pullRequests, outcome: prOutcomes, repo: repos })
      .from(pullRequests)
      .innerJoin(prOutcomes, eq(prOutcomes.prId, pullRequests.id))
      .innerJoin(repos, eq(repos.id, pullRequests.repoId))
      .where(and(eq(pullRequests.teamId, teamId), gte(prOutcomes.reworkScore, 30)))
      .orderBy(desc(prOutcomes.reworkScore))
      .limit(20)

    if (outcomeRows.length > 0) {
      res.json(
        outcomeRows.map(({ pr, outcome, repo }) => ({
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
      return
    }

    // Tier 2: heuristic signals from pull_requests (no outcome data yet)
    const signalRows = await db
      .select({ pr: pullRequests, repo: repos })
      .from(pullRequests)
      .innerJoin(repos, eq(repos.id, pullRequests.repoId))
      .where(
        and(
          eq(pullRequests.teamId, teamId),
          eq(pullRequests.state, 'merged'),
          isNotNull(pullRequests.mergedAt),
          sql`(
            (${pullRequests.deletions} > ${pullRequests.additions} * 2 AND ${pullRequests.deletions} > 50)
            OR
            (${pullRequests.mergedAt} - ${pullRequests.openedAt} > INTERVAL '7 days')
          )`,
        ),
      )
      .orderBy(desc(pullRequests.mergedAt))
      .limit(10)

    if (signalRows.length > 0) {
      res.json(
        signalRows.map(({ pr, repo }) => {
          const deletionHeavy =
            (pr.deletions ?? 0) > (pr.additions ?? 0) * 2 && (pr.deletions ?? 0) > 50
          const mergedMs = pr.mergedAt?.getTime() ?? 0
          const openedMs = pr.openedAt.getTime()
          const slowReview = mergedMs > 0 && mergedMs - openedMs > 7 * 86_400_000
          const daysOpen = mergedMs > 0 ? Math.round((mergedMs - openedMs) / 86_400_000) : 0
          const reason = [
            deletionHeavy && `high deletion ratio (${pr.deletions}− vs ${pr.additions}+)`,
            slowReview && `slow review (${daysOpen}d open before merge)`,
          ]
            .filter(Boolean)
            .join(', ') || 'flagged for review'
          return {
            id: pr.id,
            number: pr.githubPrNumber,
            title: pr.title,
            url: `https://github.com/${repo.owner}/${repo.name}/pull/${pr.githubPrNumber}`,
            reason,
            aiSummary: null,
            reworkScore: deletionHeavy ? 35 : 30,
            aiSource: pr.aiSource,
            mergedAt: pr.mergedAt?.toISOString() ?? null,
          }
        }),
      )
      return
    }

    // Tier 3: sample PRs so dashboard always shows something during onboarding/demo
    const now = Date.now()
    res.json([
      {
        id: 'sample-1',
        number: 142,
        title: 'Refactor auth middleware (large deletion ratio)',
        url: '#',
        reason: 'deletions > 2× additions — potential over-refactor',
        aiSummary:
          'This PR deleted significantly more code than it added, which can indicate scope creep or an incomplete refactor that may require follow-up fixes.',
        reworkScore: 45,
        aiSource: 'copilot',
        mergedAt: new Date(now - 3 * 86_400_000).toISOString(),
      },
      {
        id: 'sample-2',
        number: 138,
        title: 'Add payment processing flow',
        url: '#',
        reason: 'open for 9 days before merge — slow review cycle',
        aiSummary:
          'Extended review time suggests blocking issues that slowed AI-assisted development. Consider smaller PR scopes.',
        reworkScore: 38,
        aiSource: 'cursor',
        mergedAt: new Date(now - 7 * 86_400_000).toISOString(),
      },
      {
        id: 'sample-3',
        number: 131,
        title: 'Database migration for user table',
        url: '#',
        reason: '2 downstream fixes required after merge',
        aiSummary: null,
        reworkScore: 32,
        aiSource: null,
        mergedAt: new Date(now - 14 * 86_400_000).toISOString(),
      },
    ])
  } catch (err) {
    console.error('[problem-prs]', err)
    res.json([])
  }
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

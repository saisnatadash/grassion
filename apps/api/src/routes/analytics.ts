import { Router, type Request, type Response } from 'express'
import { eq, and, sql, gte, desc } from 'drizzle-orm'
import {
  pullRequests, users, savingsEvents, teams, teamWeeklyMetrics,
  weeklySnapshots, developerHistory, teamMilestones,
} from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'

export const analyticsRouter = Router()

const SEAT_COST_USD = 19

async function freshTeamId(githubLogin: string, fallback: string): Promise<string> {
  const row = await db.select({ teamId: users.teamId }).from(users).where(eq(users.githubLogin, githubLogin)).limit(1)
  return row[0]?.teamId ?? fallback
}

function getWeekStart(): Date {
  const now = new Date()
  const day = now.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff))
}

async function checkAndRecordMilestones(
  teamId: string,
  data: { aiPrs: number; totalPrs: number; inactiveSeats: number; netRoi: number },
) {
  const { aiPrs, totalPrs, inactiveSeats, netRoi } = data
  const adoption = totalPrs > 0 ? (aiPrs / totalPrs) * 100 : 0

  const checks = [
    { type: 'first_ai_pr',      condition: aiPrs >= 1 },
    { type: 'adoption_50pct',   condition: adoption >= 50 },
    { type: 'adoption_80pct',   condition: adoption >= 80 },
    { type: 'roi_positive',     condition: netRoi > 0 },
    { type: 'waste_eliminated', condition: inactiveSeats === 0 && totalPrs > 0 },
  ]

  const passing = checks.filter((c) => c.condition).map((c) => c.type)
  if (!passing.length) return

  await db
    .insert(teamMilestones)
    .values(passing.map((type) => ({ teamId, milestone: type })))
    .onConflictDoNothing()
}

analyticsRouter.get('/api/analytics/seat-waste', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const teamId = await freshTeamId(sess.githubLogin, sess.teamId)
  console.log('[seat-waste] githubLogin:', sess.githubLogin, 'sessionTeamId:', sess.teamId, 'freshTeamId:', teamId)

  try {
    // All team users with their AI PR count (merged last 7 days)
    const rows = await db
      .select({
        githubLogin: users.githubLogin,
        avatarUrl: users.avatarUrl,
        aiPrCount: sql<number>`COUNT(${pullRequests.id}) FILTER (
          WHERE ${pullRequests.aiSource} IS NOT NULL
          AND ${pullRequests.mergedAt} > NOW() - INTERVAL '7 days'
        )::int`,
        lastActivity: sql<string | null>`MAX(${pullRequests.openedAt})::text`,
      })
      .from(users)
      .leftJoin(
        pullRequests,
        and(
          eq(pullRequests.authorLogin, users.githubLogin),
          eq(pullRequests.teamId, users.teamId),
        ),
      )
      .where(eq(users.teamId, teamId))
      .groupBy(users.githubLogin, users.avatarUrl)

    console.log('[seat-waste] users returned:', rows.length)

    const activeUsers = rows
      .filter((r) => r.aiPrCount > 0)
      .map((r) => ({
        githubLogin: r.githubLogin,
        avatarUrl: r.avatarUrl,
        weeklyAiPrs: r.aiPrCount,
        lastActivity: r.lastActivity,
      }))
      .sort((a, b) => b.weeklyAiPrs - a.weeklyAiPrs)

    const inactiveUsers = rows
      .filter((r) => r.aiPrCount === 0)
      .map((r) => ({
        githubLogin: r.githubLogin,
        avatarUrl: r.avatarUrl,
        lastActivity: r.lastActivity,
        monthlyCost: SEAT_COST_USD,
      }))
      .sort((a, b) => {
        const ta = a.lastActivity ? new Date(a.lastActivity).getTime() : 0
        const tb = b.lastActivity ? new Date(b.lastActivity).getTime() : 0
        return ta - tb
      })

    const monthlyWaste = inactiveUsers.length * SEAT_COST_USD

    // Log a savings event at most once per day per team (always, even when inactiveCount=0)
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const recent = await db
        .select({ id: savingsEvents.id })
        .from(savingsEvents)
        .where(and(eq(savingsEvents.teamId, teamId), gte(savingsEvents.detectedAt, oneDayAgo)))
        .limit(1)
      if (!recent.length) {
        await db.insert(savingsEvents).values({
          teamId,
          inactiveCount: inactiveUsers.length,
          monthlyWasteUsd: monthlyWaste,
        })
      }
    } catch (savingsErr) {
      console.warn('[seat-waste] savings event write skipped:', (savingsErr as Error).message)
    }

    // Upsert seat data into weekly_snapshots
    const weekStart = getWeekStart()
    db.insert(weeklySnapshots)
      .values({
        teamId,
        weekStart,
        totalSeats: rows.length,
        activeSeats: activeUsers.length,
        inactiveSeats: inactiveUsers.length,
        monthlyWasteUsd: monthlyWaste,
      })
      .onConflictDoUpdate({
        target: [weeklySnapshots.teamId, weeklySnapshots.weekStart],
        set: {
          totalSeats: rows.length,
          activeSeats: activeUsers.length,
          inactiveSeats: inactiveUsers.length,
          monthlyWasteUsd: monthlyWaste,
          computedAt: new Date(),
        },
      })
      .catch((e: Error) => console.warn('[seat-waste] snapshot upsert skipped:', e.message))

    // Weekly PR totals for milestone checking
    const [weeklyTotals] = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        ai: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL)::int`,
      })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.teamId, teamId),
          gte(pullRequests.mergedAt, weekStart),
          eq(pullRequests.state, 'merged'),
        ),
      )

    // PART 4: Auto-milestone detection
    checkAndRecordMilestones(teamId, {
      aiPrs: weeklyTotals?.ai ?? 0,
      totalPrs: weeklyTotals?.total ?? 0,
      inactiveSeats: inactiveUsers.length,
      netRoi: 0, // ROI is set by the metrics endpoint
    }).catch((e: Error) => console.warn('[seat-waste] milestone check skipped:', e.message))

    // Insert developer_history for each team member this week
    db.insert(developerHistory)
      .values(
        rows.map((r) => ({
          teamId,
          githubLogin: r.githubLogin,
          weekStart,
          aiPrCount: r.aiPrCount ?? 0,
          totalPrCount: 0,
          isActive: (r.aiPrCount ?? 0) > 0,
        })),
      )
      .onConflictDoNothing()
      .catch((e: Error) => console.warn('[seat-waste] dev history skipped:', e.message))

    res.json({
      totalSeats: rows.length,
      activeUsers,
      inactiveUsers,
      totalMonthlySavings: monthlyWaste,
    })
  } catch (err) {
    console.error('[seat-waste]', err)
    res.status(500).json({ error: 'internal_error' })
  }
})

const MILESTONE_LABELS: Record<string, string> = {
  first_ai_pr:      'First AI PR',
  adoption_50pct:   '50% Adoption',
  adoption_80pct:   '80% Adoption',
  waste_eliminated: 'Zero Waste',
  roi_positive:     'ROI Positive',
  one_month_streak: '1 Month Streak',
}

analyticsRouter.get('/api/analytics/journey', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const teamId = await freshTeamId(sess.githubLogin, sess.teamId)

  try {
    // Days since team was created
    const [teamRow] = await db
      .select({ createdAt: teams.createdAt })
      .from(teams)
      .where(eq(teams.id, teamId))
    const daysConnected = teamRow
      ? Math.floor((Date.now() - new Date(teamRow.createdAt).getTime()) / 86_400_000)
      : 0

    // Total waste identified — max waste per calendar month, summed
    const wasteByMonth = await db
      .select({ monthMax: sql<number>`MAX(${savingsEvents.monthlyWasteUsd})::real` })
      .from(savingsEvents)
      .where(eq(savingsEvents.teamId, teamId))
      .groupBy(sql`DATE_TRUNC('month', ${savingsEvents.detectedAt})`)
    const totalWasteIdentified = wasteByMonth.reduce((s, r) => s + (r.monthMax ?? 0), 0)

    // Weekly snapshots for ROI + adoption history
    const snapshots = await db
      .select()
      .from(weeklySnapshots)
      .where(eq(weeklySnapshots.teamId, teamId))
      .orderBy(desc(weeklySnapshots.weekStart))
      .limit(12)

    // Fall back to teamWeeklyMetrics if no snapshots yet
    const metrics = snapshots.length === 0
      ? await db
          .select()
          .from(teamWeeklyMetrics)
          .where(eq(teamWeeklyMetrics.teamId, teamId))
          .orderBy(desc(teamWeeklyMetrics.weekStart))
          .limit(12)
      : []

    const latestSnap = snapshots[0] ?? null
    const firstSnap = snapshots[snapshots.length - 1] ?? null

    const bestWeekRoi = snapshots.length > 0
      ? snapshots.reduce((best, s) => Math.max(best, s.netRoiUsd ?? 0), 0)
      : metrics.reduce((best, m) => Math.max(best, (m.estimatedDollarSaved ?? 0) - (m.estimatedDollarLost ?? 0)), 0)

    const latestAdoption = latestSnap
      ? Math.round((latestSnap.aiAdoptionPct ?? 0) * 100)
      : (metrics[0] && (metrics[0].totalPrs ?? 0) > 0)
        ? Math.round(((metrics[0].aiPrs ?? 0) / metrics[0].totalPrs!) * 100)
        : 0

    const firstAdoption = firstSnap
      ? Math.round((firstSnap.aiAdoptionPct ?? 0) * 100)
      : (metrics[metrics.length - 1] && (metrics[metrics.length - 1]?.totalPrs ?? 0) > 0)
        ? Math.round(((metrics[metrics.length - 1]?.aiPrs ?? 0) / metrics[metrics.length - 1]!.totalPrs!) * 100)
        : 0

    // ROI positive milestone: check from snapshots or metrics
    const currentNetRoi = latestSnap
      ? (latestSnap.netRoiUsd ?? 0)
      : metrics[0]
        ? (metrics[0].estimatedDollarSaved ?? 0) - (metrics[0].estimatedDollarLost ?? 0)
        : 0
    const totalAiPrsEver = snapshots.reduce((s, snap) => s + (snap.aiPrs ?? 0), 0)
      || metrics.reduce((s, m) => s + (m.aiPrs ?? 0), 0)
    const streakWeeks = snapshots.length || metrics.length

    // Read + update milestones
    const existingMilestones = await db
      .select({ milestone: teamMilestones.milestone, achievedAt: teamMilestones.achievedAt })
      .from(teamMilestones)
      .where(eq(teamMilestones.teamId, teamId))

    const achieved = new Map(existingMilestones.map((m) => [m.milestone, m.achievedAt]))
    const toRecord: string[] = []

    if (totalAiPrsEver > 0 && !achieved.has('first_ai_pr')) toRecord.push('first_ai_pr')
    if (latestAdoption >= 50 && !achieved.has('adoption_50pct')) toRecord.push('adoption_50pct')
    if (latestAdoption >= 80 && !achieved.has('adoption_80pct')) toRecord.push('adoption_80pct')
    if (currentNetRoi > 0 && !achieved.has('roi_positive')) toRecord.push('roi_positive')
    if (totalWasteIdentified >= 100 && !achieved.has('waste_eliminated')) toRecord.push('waste_eliminated')
    if (streakWeeks >= 4 && !achieved.has('one_month_streak')) toRecord.push('one_month_streak')

    if (toRecord.length) {
      await db
        .insert(teamMilestones)
        .values(toRecord.map((m) => ({ teamId, milestone: m })))
        .onConflictDoNothing()
        .catch((e: Error) => console.warn('[journey] milestones write skipped:', e.message))
      for (const m of toRecord) achieved.set(m, new Date())
    }

    const milestones = Array.from(achieved.entries()).map(([type, achievedAt]) => ({
      type,
      label: MILESTONE_LABELS[type] ?? type,
      achievedAt: (achievedAt instanceof Date ? achievedAt : new Date(achievedAt)).toISOString(),
    }))

    res.json({
      daysConnected,
      totalWasteIdentified,
      bestWeekRoi,
      firstAdoption,
      latestAdoption,
      milestones,
    })
  } catch (err) {
    console.error('[journey]', err)
    res.status(500).json({ error: 'internal_error' })
  }
})

analyticsRouter.get('/api/analytics/savings-history', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const teamId = await freshTeamId(sess.githubLogin, sess.teamId)
  console.log('[savings-history] teamId:', teamId)

  try {
    // Aggregate by calendar month: take max waste per month (avoids inflating totals from multiple daily events)
    const history = await db
      .select({
        monthStart: sql<string>`DATE_TRUNC('month', ${savingsEvents.detectedAt})::text`,
        wasteUsd: sql<number>`MAX(${savingsEvents.monthlyWasteUsd})::real`,
        label: sql<string>`TO_CHAR(${savingsEvents.detectedAt}, 'Mon YYYY')`,
      })
      .from(savingsEvents)
      .where(
        and(
          eq(savingsEvents.teamId, teamId),
          gte(savingsEvents.detectedAt, sql`NOW() - INTERVAL '12 months'`),
        ),
      )
      .groupBy(sql`DATE_TRUNC('month', ${savingsEvents.detectedAt})`, sql`TO_CHAR(${savingsEvents.detectedAt}, 'Mon YYYY')`)
      .orderBy(desc(sql`DATE_TRUNC('month', ${savingsEvents.detectedAt})`))
      .limit(12)

    const monthlyHistory = history.map((r) => ({ month: r.label, wasteUsd: r.wasteUsd ?? 0 })).reverse()
    const totalWasteIdentified = monthlyHistory.reduce((s, m) => s + m.wasteUsd, 0)

    const thisMonth = new Date()
    thisMonth.setDate(1)
    thisMonth.setHours(0, 0, 0, 0)
    const thisMonthEntry = history.find((r) => {
      const rowDate = new Date(r.monthStart)
      return rowDate.getFullYear() === thisMonth.getFullYear() && rowDate.getMonth() === thisMonth.getMonth()
    })
    const thisMonthWaste = thisMonthEntry?.wasteUsd ?? 0

    console.log('[savings-history] returning:', { totalWasteIdentified, thisMonthWaste, months: monthlyHistory.length })
    res.json({ totalWasteIdentified, thisMonthWaste, monthlyHistory })
  } catch (err) {
    console.error('[savings-history] error (returning zeros):', (err as Error).message)
    res.json({ totalWasteIdentified: 0, thisMonthWaste: 0, monthlyHistory: [] })
  }
})

analyticsRouter.get('/api/analytics/health', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const teamId = await freshTeamId(sess.githubLogin, sess.teamId)

  try {
    const [[overall], trendRows, devRows] = await Promise.all([
      db
        .select({
          totalAiPrs: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL)::int`,
          reverted: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL AND ${pullRequests.wasReverted} = true)::int`,
          hotfix: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL AND ${pullRequests.triggeredHotfix} = true)::int`,
          avgChanges: sql<number>`COALESCE(AVG(${pullRequests.changesRequestedCount}) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL), 0)::real`,
        })
        .from(pullRequests)
        .where(and(eq(pullRequests.teamId, teamId), eq(pullRequests.state, 'merged'))),

      db
        .select({
          weekStart: sql<string>`DATE_TRUNC('week', ${pullRequests.mergedAt})::text`,
          totalAiPrs: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL)::int`,
          reverted: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL AND ${pullRequests.wasReverted} = true)::int`,
          hotfix: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL AND ${pullRequests.triggeredHotfix} = true)::int`,
          avgChanges: sql<number>`COALESCE(AVG(${pullRequests.changesRequestedCount}) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL), 0)::real`,
        })
        .from(pullRequests)
        .where(
          and(
            eq(pullRequests.teamId, teamId),
            eq(pullRequests.state, 'merged'),
            sql`${pullRequests.mergedAt} IS NOT NULL AND ${pullRequests.mergedAt} >= NOW() - INTERVAL '12 weeks'`,
          ),
        )
        .groupBy(sql`DATE_TRUNC('week', ${pullRequests.mergedAt})`)
        .orderBy(sql`DATE_TRUNC('week', ${pullRequests.mergedAt})`),

      db
        .select({
          authorLogin: pullRequests.authorLogin,
          avatarUrl: users.avatarUrl,
          weeklyAiPrs: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL AND ${pullRequests.mergedAt} > NOW() - INTERVAL '7 days')::int`,
          prevWeekAiPrs: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL AND ${pullRequests.mergedAt} BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days')::int`,
          totalAiPrs: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL)::int`,
          reverted: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL AND ${pullRequests.wasReverted} = true)::int`,
          hotfix: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL AND ${pullRequests.triggeredHotfix} = true)::int`,
          avgChanges: sql<number>`COALESCE(AVG(${pullRequests.changesRequestedCount}) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL), 0)::real`,
          primaryTool: sql<string | null>`MODE() WITHIN GROUP (ORDER BY ${pullRequests.aiSource}) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL)`,
        })
        .from(pullRequests)
        .leftJoin(
          users,
          and(
            sql`${users.githubLogin} = ${pullRequests.authorLogin}`,
            eq(users.teamId, pullRequests.teamId),
          ),
        )
        .where(
          and(
            eq(pullRequests.teamId, teamId),
            eq(pullRequests.state, 'merged'),
            sql`${pullRequests.authorLogin} IS NOT NULL`,
          ),
        )
        .groupBy(pullRequests.authorLogin, users.avatarUrl),
    ])

    const totalAiPrs = overall?.totalAiPrs ?? 0
    const revertFraction = totalAiPrs > 0 ? (overall?.reverted ?? 0) / totalAiPrs : 0
    const hotfixFraction = totalAiPrs > 0 ? (overall?.hotfix ?? 0) / totalAiPrs : 0
    const avgChanges = overall?.avgChanges ?? 0
    const healthScore = calcQualityScore(revertFraction, hotfixFraction, avgChanges)
    const revertRate = Math.round(revertFraction * 100)
    const hotfixRate = Math.round(hotfixFraction * 100)
    const avgReviewCycles = Math.round(avgChanges * 10) / 10

    const riskLevel: 'low' | 'medium' | 'high' =
      revertRate > 15 || hotfixRate > 15 ? 'high' :
      revertRate > 8 || hotfixRate > 10 ? 'medium' : 'low'

    const trend = trendRows
      .filter((r) => (r.totalAiPrs ?? 0) > 0)
      .map((r) => {
        const rf = r.totalAiPrs > 0 ? r.reverted / r.totalAiPrs : 0
        const hf = r.totalAiPrs > 0 ? r.hotfix / r.totalAiPrs : 0
        return { weekStart: r.weekStart, score: calcQualityScore(rf, hf, r.avgChanges), totalAiPrs: r.totalAiPrs }
      })

    const developers = devRows
      .filter((r) => r.authorLogin !== null && (r.totalAiPrs ?? 0) > 0)
      .map((r) => {
        const rf = r.totalAiPrs > 0 ? r.reverted / r.totalAiPrs : 0
        const hf = r.totalAiPrs > 0 ? r.hotfix / r.totalAiPrs : 0
        const qualityScore = calcQualityScore(rf, hf, r.avgChanges)
        const devTrend: 'up' | 'stable' | 'down' =
          r.weeklyAiPrs > r.prevWeekAiPrs ? 'up' :
          r.weeklyAiPrs < r.prevWeekAiPrs ? 'down' : 'stable'
        const status: 'power_user' | 'active' | 'needs_support' =
          qualityScore >= 75 && r.weeklyAiPrs >= 3 ? 'power_user' :
          qualityScore < 50 ? 'needs_support' : 'active'
        return {
          githubLogin: r.authorLogin as string,
          avatarUrl: r.avatarUrl,
          weeklyAiPrs: r.weeklyAiPrs,
          totalAiPrs: r.totalAiPrs,
          qualityScore,
          primaryTool: r.primaryTool,
          trend: devTrend,
          status,
        }
      })
      .sort((a, b) => b.qualityScore - a.qualityScore)

    const riskSignals: Array<{ type: string; description: string }> = []
    if (revertRate > 8)
      riskSignals.push({ type: 'high_revert_rate', description: `${revertRate}% of AI PRs were reverted — above the healthy threshold of 8%` })
    if (hotfixRate > 10)
      riskSignals.push({ type: 'high_hotfix_rate', description: `${hotfixRate}% of AI PRs triggered a hotfix — above the healthy threshold of 10%` })
    if (avgChanges > 2)
      riskSignals.push({ type: 'high_review_cycles', description: `AI PRs average ${avgReviewCycles.toFixed(1)} review cycles — indicates recurring code quality issues` })

    res.json({ healthScore, riskLevel, weekCount: trend.length, revertRate, hotfixRate, avgReviewCycles, totalAiPrs, trend, developers, riskSignals })
  } catch (err) {
    console.error('[health]', err)
    res.status(500).json({ error: 'internal_error' })
  }
})

function calcQualityScore(revertFraction: number, hotfixFraction: number, avgChanges: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - revertFraction * 40 - hotfixFraction * 30 - avgChanges * 10)))
}

function qualityVerdict(score: number): 'high_quality' | 'average' | 'low_quality' {
  return score >= 75 ? 'high_quality' : score >= 50 ? 'average' : 'low_quality'
}

analyticsRouter.get('/api/analytics/outcomes', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const teamId = await freshTeamId(sess.githubLogin, sess.teamId)

  try {
    // Global aggregate + per-tool aggregate in parallel
    const [[stats], [teamRow], toolRows] = await Promise.all([
      db
        .select({
          totalAiPrs: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL)::int`,
          revertedAiPrs: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL AND ${pullRequests.wasReverted} = true)::int`,
          hotfixAiPrs: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL AND ${pullRequests.triggeredHotfix} = true)::int`,
          avgChangesRequested: sql<number>`COALESCE(AVG(${pullRequests.changesRequestedCount}) FILTER (WHERE ${pullRequests.aiSource} IS NOT NULL), 0)::real`,
        })
        .from(pullRequests)
        .where(and(eq(pullRequests.teamId, teamId), eq(pullRequests.state, 'merged'))),
      db
        .select({ monthlyAiSpendUsd: teams.monthlyAiSpendUsd })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1),
      db
        .select({
          tool: pullRequests.aiSource,
          prCount: sql<number>`COUNT(*)::int`,
          revertedCount: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.wasReverted} = true)::int`,
          hotfixCount: sql<number>`COUNT(*) FILTER (WHERE ${pullRequests.triggeredHotfix} = true)::int`,
          avgChanges: sql<number>`COALESCE(AVG(${pullRequests.changesRequestedCount}), 0)::real`,
        })
        .from(pullRequests)
        .where(
          and(
            eq(pullRequests.teamId, teamId),
            eq(pullRequests.state, 'merged'),
            sql`${pullRequests.aiSource} IS NOT NULL`,
          ),
        )
        .groupBy(pullRequests.aiSource)
        .orderBy(desc(sql`COUNT(*)`)),
    ])

    const totalAiPrs = stats?.totalAiPrs ?? 0
    const revertedAiPrs = stats?.revertedAiPrs ?? 0
    const hotfixAiPrs = stats?.hotfixAiPrs ?? 0
    const avgChangesRequested = stats?.avgChangesRequested ?? 0
    const monthlyAiSpendUsd = teamRow?.monthlyAiSpendUsd ?? 0

    const revertFraction = totalAiPrs > 0 ? revertedAiPrs / totalAiPrs : 0
    const hotfixFraction = totalAiPrs > 0 ? hotfixAiPrs / totalAiPrs : 0
    const aiPrQualityScore = calcQualityScore(revertFraction, hotfixFraction, avgChangesRequested)

    const toolBreakdown = toolRows
      .filter((r): r is typeof r & { tool: string } => r.tool !== null)
      .map((r) => {
        const rf = r.prCount > 0 ? r.revertedCount / r.prCount : 0
        const hf = r.prCount > 0 ? r.hotfixCount / r.prCount : 0
        const score = calcQualityScore(rf, hf, r.avgChanges)
        return {
          tool: r.tool,
          prCount: r.prCount,
          revertedCount: r.revertedCount,
          revertRate: Math.round(rf * 100),
          hotfixCount: r.hotfixCount,
          hotfixRate: Math.round(hf * 100),
          avgChangesRequested: Math.round(r.avgChanges * 10) / 10,
          qualityScore: score,
          estimatedMonthlySpend: totalAiPrs > 0 ? Math.round((r.prCount / totalAiPrs) * monthlyAiSpendUsd) : 0,
          verdict: qualityVerdict(score),
        }
      })

    res.json({
      totalAiPrs,
      revertedAiPrs,
      revertRate: Math.round(revertFraction * 100),
      hotfixRate: Math.round(hotfixFraction * 100),
      avgReviewChangesRequested: Math.round(avgChangesRequested * 10) / 10,
      aiPrQualityScore,
      verdict: qualityVerdict(aiPrQualityScore),
      toolBreakdown,
    })
  } catch (err) {
    console.error('[outcomes]', err)
    res.status(500).json({ error: 'internal_error' })
  }
})

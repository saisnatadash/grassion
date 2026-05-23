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

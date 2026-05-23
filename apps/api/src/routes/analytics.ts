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

analyticsRouter.get('/api/analytics/seat-waste', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const teamId = await freshTeamId(sess.githubLogin, sess.teamId)
  console.log('[seat-waste] githubLogin:', sess.githubLogin, 'sessionTeamId:', sess.teamId, 'freshTeamId:', teamId)

  try {
    // Single LEFT JOIN query: all team users with their AI PR count (merged last 7 days)
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

function getWeekStart(): Date {
  const now = new Date()
  const day = now.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff))
}

const MILESTONE_LABELS: Record<string, string> = {
  first_ai_pr: 'First AI PR',
  adoption_50pct: '50% AI Adoption',
  adoption_80pct: '80% AI Adoption',
  waste_eliminated: '$100 Waste Found',
  roi_positive: 'Positive ROI Week',
  one_month_streak: 'One Month Streak',
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
    const daysSinceConnected = teamRow
      ? Math.floor((Date.now() - new Date(teamRow.createdAt).getTime()) / 86_400_000)
      : 0

    // Total waste identified — max waste per calendar month, summed
    const wasteByMonth = await db
      .select({ monthMax: sql<number>`MAX(${savingsEvents.monthlyWasteUsd})::real` })
      .from(savingsEvents)
      .where(eq(savingsEvents.teamId, teamId))
      .groupBy(sql`DATE_TRUNC('month', ${savingsEvents.detectedAt})`)
    const totalWasteIdentified = wasteByMonth.reduce((s, r) => s + (r.monthMax ?? 0), 0)

    // Weekly metrics history (up to 12 weeks)
    const metrics = await db
      .select()
      .from(teamWeeklyMetrics)
      .where(eq(teamWeeklyMetrics.teamId, teamId))
      .orderBy(desc(teamWeeklyMetrics.weekStart))
      .limit(12)

    const currentWeek = metrics[0] ?? null
    const firstWeek = metrics[metrics.length - 1] ?? null
    const bestWeekRoiUsd = metrics.reduce((best, m) => {
      const net = (m.estimatedDollarSaved ?? 0) - (m.estimatedDollarLost ?? 0)
      return net > best ? net : best
    }, 0)
    const aiAdoptionNow = currentWeek && (currentWeek.totalPrs ?? 0) > 0
      ? Math.round(((currentWeek.aiPrs ?? 0) / currentWeek.totalPrs!) * 100)
      : 0
    const aiAdoptionFirst = firstWeek && (firstWeek.totalPrs ?? 0) > 0
      ? Math.round(((firstWeek.aiPrs ?? 0) / firstWeek.totalPrs!) * 100)
      : 0

    // PART 2: Insert weekly_snapshot for current week if not yet recorded
    if (currentWeek) {
      try {
        const existingSnap = await db
          .select({ id: weeklySnapshots.id })
          .from(weeklySnapshots)
          .where(and(eq(weeklySnapshots.teamId, teamId), eq(weeklySnapshots.weekStart, currentWeek.weekStart)))
          .limit(1)
        if (!existingSnap.length) {
          const netEst = (currentWeek.estimatedDollarSaved ?? 0) - (currentWeek.estimatedDollarLost ?? 0)
          const adoptionFrac = (currentWeek.totalPrs ?? 0) > 0
            ? (currentWeek.aiPrs ?? 0) / currentWeek.totalPrs!
            : 0
          await db.insert(weeklySnapshots).values({
            teamId,
            weekStart: currentWeek.weekStart,
            aiPrs: currentWeek.aiPrs ?? 0,
            totalPrs: currentWeek.totalPrs ?? 0,
            adoptionPct: adoptionFrac,
            netDollarEstimate: netEst,
            wastedUsd: totalWasteIdentified,
          }).onConflictDoNothing()
        }
      } catch (snapErr) {
        console.warn('[journey] weekly_snapshot write skipped:', (snapErr as Error).message)
      }
    }

    // PART 3: Insert developer_history for each team member this week
    try {
      const weekStart = getWeekStart()
      const devRows = await db
        .select({
          githubLogin: users.githubLogin,
          aiPrCount: sql<number>`COUNT(${pullRequests.id}) FILTER (
            WHERE ${pullRequests.aiSource} IS NOT NULL
            AND ${pullRequests.mergedAt} >= ${weekStart}
          )::int`,
          totalPrCount: sql<number>`COUNT(${pullRequests.id}) FILTER (
            WHERE ${pullRequests.mergedAt} >= ${weekStart}
          )::int`,
        })
        .from(users)
        .leftJoin(
          pullRequests,
          and(eq(pullRequests.authorLogin, users.githubLogin), eq(pullRequests.teamId, users.teamId)),
        )
        .where(eq(users.teamId, teamId))
        .groupBy(users.githubLogin)

      for (const dev of devRows) {
        await db.insert(developerHistory).values({
          teamId,
          githubLogin: dev.githubLogin,
          weekStart,
          aiPrCount: dev.aiPrCount ?? 0,
          totalPrCount: dev.totalPrCount ?? 0,
          isActive: (dev.aiPrCount ?? 0) > 0,
        }).onConflictDoNothing()
      }
    } catch (devErr) {
      console.warn('[journey] developer_history write skipped:', (devErr as Error).message)
    }

    // PART 4: Check and record team milestones
    const existingMilestones = await db
      .select({ milestone: teamMilestones.milestone, achievedAt: teamMilestones.achievedAt })
      .from(teamMilestones)
      .where(eq(teamMilestones.teamId, teamId))

    const achieved = new Map(existingMilestones.map((m) => [m.milestone, m.achievedAt]))
    const toRecord: string[] = []
    const totalAiPrs = metrics.reduce((s, m) => s + (m.aiPrs ?? 0), 0)
    const currentAdoption = currentWeek && (currentWeek.totalPrs ?? 0) > 0
      ? (currentWeek.aiPrs ?? 0) / currentWeek.totalPrs!
      : 0

    if (totalAiPrs > 0 && !achieved.has('first_ai_pr')) toRecord.push('first_ai_pr')
    if (currentAdoption >= 0.5 && !achieved.has('adoption_50pct')) toRecord.push('adoption_50pct')
    if (currentAdoption >= 0.8 && !achieved.has('adoption_80pct')) toRecord.push('adoption_80pct')
    if (bestWeekRoiUsd > 0 && !achieved.has('roi_positive')) toRecord.push('roi_positive')
    if (totalWasteIdentified >= 100 && !achieved.has('waste_eliminated')) toRecord.push('waste_eliminated')
    if (metrics.length >= 4 && !achieved.has('one_month_streak')) toRecord.push('one_month_streak')

    if (toRecord.length) {
      try {
        await db.insert(teamMilestones).values(
          toRecord.map((m) => ({ teamId, milestone: m }))
        ).onConflictDoNothing()
        for (const m of toRecord) achieved.set(m, new Date())
      } catch (msErr) {
        console.warn('[journey] milestones write skipped:', (msErr as Error).message)
      }
    }

    const milestones = Array.from(achieved.entries()).map(([key, achievedAt]) => ({
      key,
      label: MILESTONE_LABELS[key] ?? key,
      achievedAt: (achievedAt instanceof Date ? achievedAt : new Date(achievedAt)).toISOString(),
    }))

    res.json({ daysSinceConnected, totalWasteIdentified, bestWeekRoiUsd, aiAdoptionNow, aiAdoptionFirst, milestones })
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
    // savings_events table may not be migrated yet — return zeros instead of crashing
    console.error('[savings-history] error (returning zeros):', (err as Error).message)
    res.json({ totalWasteIdentified: 0, thisMonthWaste: 0, monthlyHistory: [] })
  }
})

import { Router, type Request, type Response } from 'express'
import { eq, and, sql, gte, desc } from 'drizzle-orm'
import { pullRequests, users, savingsEvents } from '@grassion/db'
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

    // Log a savings event at most once every 6 hours per team
    if (inactiveUsers.length > 0) {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
      const recent = await db
        .select({ id: savingsEvents.id })
        .from(savingsEvents)
        .where(and(eq(savingsEvents.teamId, teamId), gte(savingsEvents.detectedAt, sixHoursAgo)))
        .limit(1)
      if (!recent.length) {
        await db.insert(savingsEvents).values({
          teamId,
          inactiveCount: inactiveUsers.length,
          monthlyWasteUsd: monthlyWaste,
        })
      }
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

analyticsRouter.get('/api/analytics/savings-history', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const teamId = await freshTeamId(sess.githubLogin, sess.teamId)

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

    res.json({ totalWasteIdentified, thisMonthWaste, monthlyHistory })
  } catch (err) {
    console.error('[savings-history]', err)
    res.status(500).json({ error: 'internal_error' })
  }
})

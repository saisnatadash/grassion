import { Router, type Request, type Response } from 'express'
import { eq, and, gte, isNotNull, sql } from 'drizzle-orm'
import { pullRequests, users } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'

export const analyticsRouter = Router()

const SEAT_COST_USD = 19

analyticsRouter.get('/api/analytics/seat-waste', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // 1. All users registered to this team
    const teamUsers = await db
      .select()
      .from(users)
      .where(eq(users.teamId, sess.teamId))

    if (teamUsers.length === 0) {
      res.json({ totalSeats: 0, activeUsers: [], inactiveUsers: [], totalMonthlySavings: 0 })
      return
    }

    // 2. Count AI PRs merged in the last 7 days, grouped by author_login
    const aiPrRows = await db
      .select({
        authorLogin: pullRequests.authorLogin,
        count: sql<number>`count(*)::int`,
      })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.teamId, sess.teamId),
          isNotNull(pullRequests.aiSource),
          gte(pullRequests.mergedAt, sevenDaysAgo),
          isNotNull(pullRequests.authorLogin),
        ),
      )
      .groupBy(pullRequests.authorLogin)

    // 3. Last PR date per author_login for lastActivity display
    const lastPrRows = await db
      .select({
        authorLogin: pullRequests.authorLogin,
        lastActivity: sql<string>`max(${pullRequests.openedAt})::text`,
      })
      .from(pullRequests)
      .where(and(eq(pullRequests.teamId, sess.teamId), isNotNull(pullRequests.authorLogin)))
      .groupBy(pullRequests.authorLogin)

    const aiCountMap = new Map<string, number>(
      aiPrRows.map((r) => [r.authorLogin!, r.count]),
    )
    const lastActivityMap = new Map<string, string>(
      lastPrRows.map((r) => [r.authorLogin!, r.lastActivity]),
    )

    const activeUsers: Array<{
      githubLogin: string
      avatarUrl: string | null
      weeklyAiPrs: number
      lastActivity: string | null
    }> = []
    const inactiveUsers: Array<{
      githubLogin: string
      avatarUrl: string | null
      lastActivity: string | null
      monthlyCost: number
    }> = []

    for (const user of teamUsers) {
      const weeklyAiPrs = aiCountMap.get(user.githubLogin) ?? 0
      const lastActivity = lastActivityMap.get(user.githubLogin) ?? null
      if (weeklyAiPrs > 0) {
        activeUsers.push({
          githubLogin: user.githubLogin,
          avatarUrl: user.avatarUrl,
          weeklyAiPrs,
          lastActivity,
        })
      } else {
        inactiveUsers.push({
          githubLogin: user.githubLogin,
          avatarUrl: user.avatarUrl,
          lastActivity,
          monthlyCost: SEAT_COST_USD,
        })
      }
    }

    activeUsers.sort((a, b) => b.weeklyAiPrs - a.weeklyAiPrs)
    inactiveUsers.sort((a, b) => {
      const ta = a.lastActivity ? new Date(a.lastActivity).getTime() : 0
      const tb = b.lastActivity ? new Date(b.lastActivity).getTime() : 0
      return ta - tb
    })

    res.json({
      totalSeats: teamUsers.length,
      activeUsers,
      inactiveUsers,
      totalMonthlySavings: inactiveUsers.length * SEAT_COST_USD,
    })
  } catch (err) {
    console.error('[seat-waste]', err)
    res.status(500).json({ error: 'internal_error' })
  }
})

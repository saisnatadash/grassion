import { Router, type Request, type Response } from 'express'
import { eq, and, gte, isNotNull } from 'drizzle-orm'
import { users, pullRequests } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'

export const analyticsRouter = Router()

const SEAT_COST_USD = 19
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

// In-memory cache per teamId — Redis not available in this deployment
const cache = new Map<string, { data: unknown; expiresAt: number }>()

analyticsRouter.get('/api/analytics/seat-waste', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!

  const hit = cache.get(sess.teamId)
  if (hit && hit.expiresAt > Date.now()) {
    res.json(hit.data)
    return
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [teamUsers, recentAiPrs, allPrs] = await Promise.all([
      db.select().from(users).where(eq(users.teamId, sess.teamId)),
      db
        .select({ authorGithubId: pullRequests.authorGithubId })
        .from(pullRequests)
        .where(
          and(
            eq(pullRequests.teamId, sess.teamId),
            isNotNull(pullRequests.aiSource),
            gte(pullRequests.createdAt, sevenDaysAgo),
          ),
        ),
      db
        .select({ authorGithubId: pullRequests.authorGithubId, openedAt: pullRequests.openedAt })
        .from(pullRequests)
        .where(eq(pullRequests.teamId, sess.teamId)),
    ])

    // Count AI PRs in the last 7 days per author
    const weeklyAiCounts = new Map<number, number>()
    for (const pr of recentAiPrs) {
      if (pr.authorGithubId === null) continue
      weeklyAiCounts.set(pr.authorGithubId, (weeklyAiCounts.get(pr.authorGithubId) ?? 0) + 1)
    }

    // Most recent PR open date per author (any PR, not just AI)
    const lastActivityMap = new Map<number, Date>()
    for (const pr of allPrs) {
      if (pr.authorGithubId === null) continue
      const existing = lastActivityMap.get(pr.authorGithubId)
      if (!existing || pr.openedAt > existing) {
        lastActivityMap.set(pr.authorGithubId, pr.openedAt)
      }
    }

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
      const weeklyAiPrs = weeklyAiCounts.get(user.githubUserId) ?? 0
      const lastDate = lastActivityMap.get(user.githubUserId)
      const lastActivity = lastDate ? lastDate.toISOString() : null

      if (weeklyAiPrs === 0) {
        inactiveUsers.push({
          githubLogin: user.githubLogin,
          avatarUrl: user.avatarUrl,
          lastActivity,
          monthlyCost: SEAT_COST_USD,
        })
      } else {
        activeUsers.push({
          githubLogin: user.githubLogin,
          avatarUrl: user.avatarUrl,
          weeklyAiPrs,
          lastActivity,
        })
      }
    }

    const result = {
      totalSeats: teamUsers.length,
      activeUsers,
      inactiveUsers,
      totalMonthlySavings: inactiveUsers.length * SEAT_COST_USD,
    }

    cache.set(sess.teamId, { data: result, expiresAt: Date.now() + CACHE_TTL_MS })
    res.json(result)
  } catch (err) {
    console.error('[seat-waste]', err)
    res.status(500).json({ error: 'internal_error' })
  }
})

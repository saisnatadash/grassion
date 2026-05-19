import { Router, type Request, type Response } from 'express'
import { eq, and, gte, isNotNull } from 'drizzle-orm'
import { teams, pullRequests } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'

export const analyticsRouter = Router()

const FALLBACK_SEAT_COST_USD = 19
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

// In-memory cache per teamId (Redis not available in this deployment)
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
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    // Load team config for per-seat cost calculation
    const teamRow = (await db.select().from(teams).where(eq(teams.id, sess.teamId)).limit(1))[0]
    const monthlyAiSpend = teamRow?.monthlyAiSpendUsd ?? 0

    // Scan all PRs from the last 30 days — this covers all developers who have
    // pushed code regardless of whether they have signed in to Grassion.
    const [recentPrs, recentAiPrs] = await Promise.all([
      db
        .select({
          authorGithubId: pullRequests.authorGithubId,
          authorLogin: pullRequests.authorLogin,
          openedAt: pullRequests.openedAt,
        })
        .from(pullRequests)
        .where(
          and(
            eq(pullRequests.teamId, sess.teamId),
            gte(pullRequests.openedAt, thirtyDaysAgo),
            isNotNull(pullRequests.authorLogin),
          ),
        ),
      db
        .select({ authorGithubId: pullRequests.authorGithubId })
        .from(pullRequests)
        .where(
          and(
            eq(pullRequests.teamId, sess.teamId),
            isNotNull(pullRequests.aiSource),
            gte(pullRequests.openedAt, sevenDaysAgo),
            isNotNull(pullRequests.authorLogin),
          ),
        ),
    ])

    // Build a per-author map keyed by GitHub numeric user ID
    const authorMap = new Map<
      number,
      { login: string; lastActivity: Date; weeklyAiPrs: number }
    >()

    for (const pr of recentPrs) {
      if (!pr.authorGithubId || !pr.authorLogin) continue
      const existing = authorMap.get(pr.authorGithubId)
      if (!existing) {
        authorMap.set(pr.authorGithubId, {
          login: pr.authorLogin,
          lastActivity: pr.openedAt,
          weeklyAiPrs: 0,
        })
      } else if (pr.openedAt > existing.lastActivity) {
        existing.lastActivity = pr.openedAt
      }
    }

    // Tally AI PR counts for the last 7 days
    for (const pr of recentAiPrs) {
      if (!pr.authorGithubId) continue
      const author = authorMap.get(pr.authorGithubId)
      if (author) author.weeklyAiPrs++
    }

    const totalSeats = authorMap.size
    // Per-seat cost: spread total monthly AI spend across all seats, floor at $19 fallback
    const perSeatCost =
      totalSeats > 0 && monthlyAiSpend > 0
        ? Math.round((monthlyAiSpend / totalSeats) * 100) / 100
        : FALLBACK_SEAT_COST_USD

    const activeUsers: Array<{
      githubLogin: string
      avatarUrl: string
      weeklyAiPrs: number
      lastActivity: string
    }> = []
    const inactiveUsers: Array<{
      githubLogin: string
      avatarUrl: string
      lastActivity: string
      monthlyCost: number
    }> = []

    for (const [githubId, author] of authorMap) {
      // Use GitHub's public avatar CDN — works without any stored avatar URL
      const avatarUrl = `https://avatars.githubusercontent.com/u/${githubId}?v=4&s=72`
      if (author.weeklyAiPrs > 0) {
        activeUsers.push({
          githubLogin: author.login,
          avatarUrl,
          weeklyAiPrs: author.weeklyAiPrs,
          lastActivity: author.lastActivity.toISOString(),
        })
      } else {
        inactiveUsers.push({
          githubLogin: author.login,
          avatarUrl,
          lastActivity: author.lastActivity.toISOString(),
          monthlyCost: perSeatCost,
        })
      }
    }

    // Sort: active → most AI PRs first; inactive → most dormant first
    activeUsers.sort((a, b) => b.weeklyAiPrs - a.weeklyAiPrs)
    inactiveUsers.sort(
      (a, b) => new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime(),
    )

    const result = {
      totalSeats,
      activeUsers,
      inactiveUsers,
      totalMonthlySavings: Math.round(inactiveUsers.length * perSeatCost * 100) / 100,
    }

    cache.set(sess.teamId, { data: result, expiresAt: Date.now() + CACHE_TTL_MS })
    res.json(result)
  } catch (err) {
    console.error('[seat-waste]', err)
    res.status(500).json({ error: 'internal_error' })
  }
})

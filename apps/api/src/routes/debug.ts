import { Router, type Request, type Response } from 'express'
import { eq, sql } from 'drizzle-orm'
import { pullRequests, users, repos } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { logger } from '../logger.js'

export const debugRouter = Router()

debugRouter.get('/api/debug/data', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!

  try {
    const [prResult, userResult, repoResult, samplePrs] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(pullRequests)
        .where(eq(pullRequests.teamId, sess.teamId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.teamId, sess.teamId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(repos)
        .where(eq(repos.teamId, sess.teamId)),
      db
        .select({
          id: pullRequests.id,
          title: pullRequests.title,
          state: pullRequests.state,
          aiSource: pullRequests.aiSource,
          authorLogin: pullRequests.authorLogin,
          mergedAt: pullRequests.mergedAt,
          teamId: pullRequests.teamId,
        })
        .from(pullRequests)
        .where(eq(pullRequests.teamId, sess.teamId))
        .limit(5),
    ])

    res.json({
      teamId: sess.teamId,
      githubLogin: sess.githubLogin,
      role: sess.role,
      prCount: prResult[0]?.count ?? 0,
      userCount: userResult[0]?.count ?? 0,
      repoCount: repoResult[0]?.count ?? 0,
      samplePrs: samplePrs.map((p) => ({
        title: p.title,
        state: p.state,
        aiSource: p.aiSource,
        authorLogin: p.authorLogin,
        mergedAt: p.mergedAt,
        teamId: p.teamId,
      })),
    })
  } catch (err) {
    logger.error({ err }, 'debug/data failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

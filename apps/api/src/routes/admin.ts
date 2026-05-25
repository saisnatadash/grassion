import { Router, type Request, type Response } from 'express'
import { eq, and } from 'drizzle-orm'
import { users } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import { runWeeklyDigest } from '../jobs/weeklyDigest.js'
import { sendTestEmail } from '../lib/email.js'
import { logger } from '../logger.js'

export const adminRouter = Router()

adminRouter.post(
  '/api/admin/trigger-digest',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    try {
      const result = await runWeeklyDigest()
      res.json({ ok: true, ...result })
    } catch (err) {
      logger.error({ err }, 'trigger-digest failed')
      res.status(500).json({ error: 'digest_failed' })
    }
  },
)

adminRouter.get(
  '/api/admin/test-email',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    try {
      const owner = (
        await db
          .select({ email: users.email, githubLogin: users.githubLogin })
          .from(users)
          .where(and(eq(users.teamId, sess.teamId), eq(users.role, 'owner')))
          .limit(1)
      )[0]

      if (!owner?.email) {
        res.status(404).json({ error: 'no_owner_email' })
        return
      }

      await sendTestEmail(owner.email, owner.githubLogin)
      res.json({ ok: true, sentTo: owner.email })
    } catch (err) {
      logger.error({ err }, 'test-email failed')
      res.status(500).json({ error: 'send_failed' })
    }
  },
)

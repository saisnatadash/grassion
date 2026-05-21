import { Router, type Request, type Response } from 'express'
import { requireAuth, requireRole } from '../auth.js'
import { runWeeklyDigest } from '../jobs/weeklyDigest.js'
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

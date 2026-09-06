import { Router, type Request, type Response } from 'express'
import { sql } from 'drizzle-orm'
import { db } from '../db.js'
import { authRouter } from './auth.js'
import { teamRouter } from './team.js'
import { reposRouter } from './repos.js'
import { metricsRouter } from './metrics.js'
import { billingRouter } from './billing.js'
import { contactRouter } from './contact.js'
import { analyticsRouter } from './analytics.js'
import { debugRouter } from './debug.js'
import { adminRouter } from './admin.js'
import { notificationsRouter } from './notifications.js'
import { securityRouter } from './security.js'
import { slackRouter } from './slack.js'

export const router = Router()

router.get('/health', async (_req: Request, res: Response) => {
  try {
    await db.execute(sql`SELECT 1`)
    res.json({ ok: true, db: 'up', ts: new Date().toISOString() })
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: (err as Error).message, ts: new Date().toISOString() })
  }
})

router.use(authRouter)
router.use(teamRouter)
router.use(reposRouter)
router.use(metricsRouter)
router.use(billingRouter)
router.use(contactRouter)
router.use(analyticsRouter)
router.use(debugRouter)
router.use(adminRouter)
router.use(notificationsRouter)
router.use(securityRouter)
router.use(slackRouter)

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
import { demoRouter } from './demo.js'

export const router = Router()

router.get('/health', async (_req: Request, res: Response) => {
  let dbStatus = 'unknown'
  let tablesOk = false
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`).then(() => { dbStatus = 'up' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 12000)),
    ])
    await db.execute(sql`SELECT 1 FROM users LIMIT 1`)
    tablesOk = true
  } catch {
    if (dbStatus === 'up') tablesOk = false
    else dbStatus = 'slow'
  }
  res.json({ ok: true, db: dbStatus, tables: tablesOk, ts: new Date().toISOString() })
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
router.use(demoRouter)

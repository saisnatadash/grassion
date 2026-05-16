import { Router, type Request, type Response } from 'express'
import { authRouter } from './auth.js'
import { teamRouter } from './team.js'
import { reposRouter } from './repos.js'
import { metricsRouter } from './metrics.js'
import { billingRouter } from './billing.js'
import { contactRouter } from './contact.js'
import { analyticsRouter } from './analytics.js'

export const router = Router()

router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

router.use(authRouter)
router.use(teamRouter)
router.use(reposRouter)
router.use(metricsRouter)
router.use(billingRouter)
router.use(contactRouter)
router.use(analyticsRouter)

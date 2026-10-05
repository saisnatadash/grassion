import { Router, type Request, type Response } from 'express'
import { eq, and, sql } from 'drizzle-orm'
import { users } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import { runWeeklyDigest } from '../jobs/weeklyDigest.js'
import { sendTestEmail } from '../lib/email.js'
import { logger } from '../logger.js'
import { env } from '../env.js'
import { logAuditEvent, getIp } from '../services/audit.js'

export const adminRouter = Router()

adminRouter.post(
  '/api/admin/trigger-digest',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    logAuditEvent({
      teamId: sess.teamId,
      userId: sess.userId,
      action: 'admin.endpoint_accessed',
      resourceType: 'admin',
      resourceId: '/api/admin/trigger-digest',
      ipAddress: getIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    })
    try {
      const result = await runWeeklyDigest()
      res.json({ ok: true, ...result })
    } catch (err) {
      logger.error({ err }, 'trigger-digest failed')
      res.status(500).json({ error: 'digest_failed' })
    }
  },
)

adminRouter.get('/api/admin/referrals', async (req: Request, res: Response) => {
  const secret = env().ADMIN_SECRET
  if (!secret) {
    res.status(501).json({ error: 'ADMIN_SECRET not configured' })
    return
  }
  const auth = req.headers.authorization
  if (auth !== `Bearer ${secret}`) {
    logger.warn({ ip: req.ip, path: req.path }, 'admin referrals: unauthorized access attempt')
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  logAuditEvent({
    teamId: null,
    userId: null,
    action: 'admin.endpoint_accessed',
    resourceType: 'admin',
    resourceId: '/api/admin/referrals',
    ipAddress: getIp(req),
    userAgent: req.headers['user-agent'] ?? null,
  })
  try {
    const rows = await db.execute(sql`
      SELECT
        rc.id,
        rc.code,
        rc.partner_name AS "partnerName",
        rc.partner_email AS "partnerEmail",
        rc.commission_pct AS "commissionPct",
        rc.is_active AS "isActive",
        rc.created_at AS "createdAt",
        COUNT(conv.id)::int AS "conversionCount",
        COALESCE(SUM(conv.mrr_usd), 0)::real AS "totalMrrUsd",
        COALESCE(SUM(conv.commission_usd), 0)::real AS "totalCommissionOwed"
      FROM referral_codes rc
      LEFT JOIN referral_conversions conv ON conv.referral_code_id = rc.id
      GROUP BY rc.id
      ORDER BY "totalCommissionOwed" DESC
    `)
    res.json({ referrals: Array.from(rows) })
  } catch (err) {
    logger.error({ err }, 'admin/referrals query failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

adminRouter.get(
  '/api/admin/test-email',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    logAuditEvent({
      teamId: sess.teamId,
      userId: sess.userId,
      action: 'admin.endpoint_accessed',
      resourceType: 'admin',
      resourceId: '/api/admin/test-email',
      ipAddress: getIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    })
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

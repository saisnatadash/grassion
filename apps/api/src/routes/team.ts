import { Router, type Request, type Response } from 'express'
import { eq, and } from 'drizzle-orm'
import { teams, users, referralCodes } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import { logger } from '../logger.js'
import { updateTeamSchema, updateTeamSettingsSchema } from '@grassion/shared'
import { logAuditEvent, getIp } from '../services/audit.js'
import { sendTestEmail, sendWeeklyDigestEmail } from '../lib/email.js'

export const teamRouter = Router()

teamRouter.get('/api/team', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  try {
    const row = await db
      .select({
        id: teams.id, name: teams.name, slug: teams.slug, plan: teams.plan,
        trialEndsAt: teams.trialEndsAt, githubInstallationId: teams.githubInstallationId,
        monthlyAiSpendUsd: teams.monthlyAiSpendUsd, avgDevHourlyRateUsd: teams.avgDevHourlyRateUsd,
        timezone: teams.timezone, emailDigestEnabled: teams.emailDigestEnabled,
        emailDigestDay: teams.emailDigestDay, emailDigestHour: teams.emailDigestHour,
        slackWebhookUrl: teams.slackWebhookUrl, perSeatCostUsd: teams.perSeatCostUsd,
        toolSeatCosts: teams.toolSeatCosts, benchmarkingOptIn: teams.benchmarkingOptIn,
        teamSizeRange: teams.teamSizeRange, industry: teams.industry, demoMode: teams.demoMode,
        hcCheckRunEnabled: teams.hcCheckRunEnabled, hcBlockOnCritical: teams.hcBlockOnCritical,
        hcMaxReviewRequests: teams.hcMaxReviewRequests, teamOnlyMode: teams.teamOnlyMode,
        perDevMetricsEnabled: teams.perDevMetricsEnabled,
      })
      .from(teams).where(eq(teams.id, sess.teamId)).limit(1)
    if (!row[0]) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    const t = row[0]
    res.json({
      id: t.id,
      name: t.name,
      slug: t.slug,
      plan: t.plan,
      trialEndsAt: t.trialEndsAt?.toISOString() ?? null,
      githubInstallationId: t.githubInstallationId,
      monthlyAiSpendUsd: t.monthlyAiSpendUsd ?? 0,
      avgDevHourlyRateUsd: t.avgDevHourlyRateUsd ?? 75,
      timezone: t.timezone ?? 'UTC',
      emailDigestEnabled: t.emailDigestEnabled ?? true,
      emailDigestDay: t.emailDigestDay ?? 1,
      emailDigestHour: t.emailDigestHour ?? 9,
      slackWebhookUrl: t.slackWebhookUrl ?? null,
      perSeatCostUsd: t.perSeatCostUsd ?? 19,
      toolSeatCosts: (t.toolSeatCosts ?? {}) as Record<string, number>,
      benchmarkingOptIn: t.benchmarkingOptIn ?? false,
      teamSizeRange: t.teamSizeRange ?? null,
      industry: t.industry ?? null,
      demoMode: t.demoMode ?? false,
      hcCheckRunEnabled: t.hcCheckRunEnabled ?? false,
      hcBlockOnCritical: t.hcBlockOnCritical ?? false,
      hcMaxReviewRequests: t.hcMaxReviewRequests ?? 2,
      teamOnlyMode: t.teamOnlyMode ?? false,
      perDevMetricsEnabled: t.perDevMetricsEnabled ?? false,
    })
  } catch (err) {
    logger.error({ err }, 'team get failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

teamRouter.patch(
  '/api/team',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const parsed = updateTeamSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() })
      return
    }
    const sess = req.session!
    try {
      await db
        .update(teams)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(teams.id, sess.teamId))
      logAuditEvent({
        teamId: sess.teamId,
        userId: sess.userId,
        action: 'team.updated',
        resourceType: 'team',
        resourceId: sess.teamId,
        ipAddress: getIp(req),
        userAgent: req.headers['user-agent'] ?? null,
        metadata: { fields: Object.keys(parsed.data) },
      })
      res.json({ ok: true })
    } catch (err) {
      logger.error({ err }, 'team patch failed')
      res.status(500).json({ error: 'internal_error' })
    }
  },
)

teamRouter.get('/api/team/members', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  try {
    const list = await db
      .select({
        id: users.id, githubLogin: users.githubLogin, email: users.email,
        avatarUrl: users.avatarUrl, role: users.role, createdAt: users.createdAt,
      })
      .from(users).where(eq(users.teamId, sess.teamId))
    res.json(
      list.map((u) => ({
        id: u.id,
        githubLogin: u.githubLogin,
        email: u.email,
        avatarUrl: u.avatarUrl,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
      })),
    )
  } catch (err) {
    logger.error({ err }, 'team members list failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

teamRouter.patch(
  '/api/team/settings',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const parsed = updateTeamSettingsSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() })
      return
    }
    const sess = req.session!
    try {
      const [updated] = await db
        .update(teams)
        .set({
          perSeatCostUsd: parsed.data.perSeatCostUsd,
          toolSeatCosts: parsed.data.toolSeatCosts,
          updatedAt: new Date(),
        })
        .where(eq(teams.id, sess.teamId))
        .returning({
          perSeatCostUsd: teams.perSeatCostUsd,
          toolSeatCosts: teams.toolSeatCosts,
        })
      logAuditEvent({
        teamId: sess.teamId,
        userId: sess.userId,
        action: 'team.settings_updated',
        resourceType: 'team',
        resourceId: sess.teamId,
        ipAddress: getIp(req),
        userAgent: req.headers['user-agent'] ?? null,
      })
      res.json({ ok: true, ...updated })
    } catch (err) {
      logger.error({ err }, 'team settings patch failed')
      res.status(500).json({ error: 'internal_error' })
    }
  },
)

teamRouter.get('/api/team/referral', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  try {
    const team = (await db.select({ referralCodeId: teams.referralCodeId }).from(teams).where(eq(teams.id, sess.teamId)).limit(1))[0]
    if (!team?.referralCodeId) {
      res.json({ referredBy: null })
      return
    }
    const code = (
      await db.select({ code: referralCodes.code, partnerName: referralCodes.partnerName }).from(referralCodes).where(eq(referralCodes.id, team.referralCodeId)).limit(1)
    )[0]
    res.json({
      referredBy: code ? { code: code.code, partnerName: code.partnerName } : null,
    })
  } catch (err) {
    logger.error({ err }, 'team referral get failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

teamRouter.delete(
  '/api/team/members/:id',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    const id = req.params.id
    if (!id) {
      res.status(400).json({ error: 'missing_id' })
      return
    }
    if (id === sess.userId) {
      res.status(400).json({ error: 'cannot_remove_self' })
      return
    }
    try {
      await db.delete(users).where(and(eq(users.id, id), eq(users.teamId, sess.teamId)))
      res.json({ ok: true })
    } catch (err) {
      logger.error({ err }, 'team member delete failed')
      res.status(500).json({ error: 'internal_error' })
    }
  },
)

// Send a test digest email to the requesting user to verify email is configured
teamRouter.post('/api/team/send-test-digest', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  try {
    const userRow = (
      await db.select({ email: users.email, githubLogin: users.githubLogin }).from(users).where(eq(users.id, sess.userId)).limit(1)
    )[0]
    if (!userRow?.email) {
      res.status(400).json({ error: 'no_email', message: 'No email address on your account.' })
      return
    }

    // Try Resend first (simple test email), fall back to Zoho SMTP demo digest
    let sent = false
    try {
      await sendTestEmail(userRow.email, userRow.githubLogin)
      sent = true
    } catch (e1) {
      logger.warn({ err: e1 }, 'sendTestEmail via Resend failed, trying Zoho SMTP')
    }

    if (!sent) {
      await sendWeeklyDigestEmail(userRow.email, {
        teamName: userRow.githubLogin,
        weekStart: new Date(),
        totalPrs: 12,
        aiPrs: 7,
        netDollar: 340,
        verdict: 'net_positive',
        speedDeltaPercent: 18,
        totalSeats: 3,
        activeSeats: 2,
        monthlyWaste: 19,
        inactiveUsers: [],
        problemPrs: [],
        dashboardUrl: 'https://app.grassion.com/dashboard',
      })
    }

    res.json({ ok: true, sentTo: userRow.email })
  } catch (err) {
    logger.error({ err }, 'send-test-digest failed')
    res.status(500).json({ error: 'send_failed', message: 'Email delivery failed. Check RESEND_API_KEY or Zoho SMTP settings on the API server.' })
  }
})

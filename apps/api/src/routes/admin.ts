import { Router, type Request, type Response } from 'express'
import { eq, and, sql, gte, lte, desc, asc, count, sum, ilike } from 'drizzle-orm'
import {
  users, teams, repos, pullRequests, llmUsageLog,
  contactSubmissions, careerApplications, analyticsEvents,
  adminAuditLog, webhookEvents, outcomeCheckQueue,
  teamWeeklyMetrics, referralConversions,
} from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireSuperAdmin } from '../auth.js'
import { runWeeklyDigest } from '../jobs/weeklyDigest.js'
import { sendTestEmail } from '../lib/email.js'
import { logger } from '../logger.js'
import { env } from '../env.js'
import { logAuditEvent, getIp } from '../services/audit.js'

export const adminRouter = Router()

// ── Legacy endpoints (keep existing auth) ────────────────────────────────────

adminRouter.post(
  '/api/admin/trigger-digest',
  requireAuth,
  requireSuperAdmin,
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
  if (!secret) { res.status(501).json({ error: 'ADMIN_SECRET not configured' }); return }
  const auth = req.headers.authorization
  if (auth !== `Bearer ${secret}`) {
    logger.warn({ ip: req.ip, path: req.path }, 'admin referrals: unauthorized access attempt')
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  logAuditEvent({ teamId: null, userId: null, action: 'admin.endpoint_accessed', resourceType: 'admin', resourceId: '/api/admin/referrals', ipAddress: getIp(req), userAgent: req.headers['user-agent'] ?? null })
  try {
    const rows = await db.select().from(referralConversions).orderBy(desc(referralConversions.convertedAt)).limit(200)
    res.json({ conversions: rows })
  } catch (err) {
    logger.error({ err }, 'admin referrals query failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── Founder-only endpoints — all protected by requireSuperAdmin ──────────────

// Check whether the current user is a superadmin (safe to call from frontend).
adminRouter.get('/api/admin/me', requireAuth, requireSuperAdmin, (_req: Request, res: Response) => {
  res.json({ isSuperAdmin: true })
})

// ── Helper: parse date range from query ──────────────────────────────────────
function parseDateRange(query: Record<string, unknown>, defaultDays = 30) {
  const now = new Date()
  if (query['from'] && query['to']) {
    const from = new Date(query['from'] as string)
    const to = new Date(query['to'] as string)
    if (!isNaN(from.getTime()) && !isNaN(to.getTime())) return { from, to }
  }
  const from = new Date(now.getTime() - defaultDays * 24 * 60 * 60 * 1000)
  return { from, to: now }
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────
adminRouter.get('/api/admin/overview', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const { from } = parseDateRange(req.query as Record<string, unknown>, 30)
  try {
    const [totalTeams] = await db.select({ c: count() }).from(teams)
    const teamsByPlan = await db
      .select({ plan: teams.plan, c: count() })
      .from(teams)
      .groupBy(teams.plan)
    const [newTeams7d] = await db
      .select({ c: count() })
      .from(teams)
      .where(gte(teams.createdAt, new Date(Date.now() - 7 * 86400_000)))
    const [totalUsers] = await db.select({ c: count() }).from(users)
    const [pageViews7d] = await db
      .select({ c: count() })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.eventName, 'page_view'), gte(analyticsEvents.occurredAt, new Date(Date.now() - 7 * 86400_000))))
    const [contactNew] = await db.select({ c: count() }).from(contactSubmissions).where(eq(contactSubmissions.status, 'new'))
    const [careersNew] = await db.select({ c: count() }).from(careerApplications).where(eq(careerApplications.status, 'new'))
    const llmToday = await db
      .select({ s: sum(llmUsageLog.estimatedCostUsd) })
      .from(llmUsageLog)
      .where(gte(llmUsageLog.createdAt, new Date(new Date().toISOString().slice(0, 10))))
    const llmMtd = await db
      .select({ s: sum(llmUsageLog.estimatedCostUsd) })
      .from(llmUsageLog)
      .where(gte(llmUsageLog.createdAt, from))

    res.json({
      totalTeams: totalTeams?.c ?? 0,
      teamsByPlan: Object.fromEntries(teamsByPlan.map((r) => [r.plan, r.c])),
      newTeams7d: newTeams7d?.c ?? 0,
      totalUsers: totalUsers?.c ?? 0,
      pageViews7d: pageViews7d?.c ?? 0,
      contactNew: contactNew?.c ?? 0,
      careersNew: careersNew?.c ?? 0,
      llmSpendToday: parseFloat((llmToday[0]?.s as string | null) ?? '0') || 0,
      llmSpendMtd: parseFloat((llmMtd[0]?.s as string | null) ?? '0') || 0,
    })
  } catch (err) {
    logger.error({ err }, 'admin overview failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── FUNNEL ────────────────────────────────────────────────────────────────────
adminRouter.get('/api/admin/funnel', requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const [step1] = await db.select({ c: count() }).from(teams)
    const [step2] = await db.select({ c: sql<number>`count(distinct team_id)` }).from(repos)
    const [step3] = await db.select({ c: sql<number>`count(distinct team_id)` }).from(pullRequests)
    const [step4] = await db.select({ c: sql<number>`count(distinct team_id)` }).from(teamWeeklyMetrics)
    const [step5] = await db.select({ c: count() }).from(teams).where(sql`plan IN ('pro', 'business', 'enterprise', 'team', 'growth', 'starter')`)
    res.json({
      funnel: [
        { label: 'Signed up', count: step1?.c ?? 0 },
        { label: 'Repo connected', count: Number(step2?.c) ?? 0 },
        { label: 'First PR tracked', count: Number(step3?.c) ?? 0 },
        { label: 'First weekly metrics', count: Number(step4?.c) ?? 0 },
        { label: 'Paid', count: step5?.c ?? 0 },
      ],
    })
  } catch (err) {
    logger.error({ err }, 'admin funnel failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── TEAMS ─────────────────────────────────────────────────────────────────────
adminRouter.get('/api/admin/teams', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>
  const page = Math.max(1, parseInt(q['page'] ?? '1', 10))
  const limit = Math.min(100, parseInt(q['limit'] ?? '50', 10))
  const search = q['search'] ?? ''
  const offset = (page - 1) * limit
  try {
    const where = search
      ? ilike(teams.githubInstallationId as unknown as Parameters<typeof ilike>[0], `%${search}%`)
      : undefined
    const rows = await db
      .select({
        id: teams.id,
        plan: teams.plan,
        createdAt: teams.createdAt,
        razorpaySubscriptionId: teams.razorpaySubscriptionId,
        subscriptionStatus: teams.subscriptionStatus,
        perSeatCostUsd: teams.perSeatCostUsd,
        benchmarkingOptIn: teams.benchmarkingOptIn,
        demoMode: teams.demoMode,
        hcCheckRunEnabled: teams.hcCheckRunEnabled,
      })
      .from(teams)
      .orderBy(desc(teams.createdAt))
      .limit(limit)
      .offset(offset)
    const [total] = await db.select({ c: count() }).from(teams)
    const teamIds = rows.map((r) => r.id)
    const userCounts = teamIds.length
      ? await db
          .select({ teamId: users.teamId, c: count() })
          .from(users)
          .where(sql`team_id = ANY(${teamIds})`)
          .groupBy(users.teamId)
      : []
    const repoCounts = teamIds.length
      ? await db
          .select({ teamId: repos.teamId, c: count() })
          .from(repos)
          .where(sql`team_id = ANY(${teamIds})`)
          .groupBy(repos.teamId)
      : []
    const userMap = Object.fromEntries(userCounts.map((r) => [r.teamId, r.c]))
    const repoMap = Object.fromEntries(repoCounts.map((r) => [r.teamId, r.c]))
    res.json({
      teams: rows.map((t) => ({
        ...t,
        userCount: userMap[t.id] ?? 0,
        repoCount: repoMap[t.id] ?? 0,
      })),
      total: total?.c ?? 0,
      page,
      limit,
    })
  } catch (err) {
    logger.error({ err }, 'admin teams failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── ENGAGEMENT ────────────────────────────────────────────────────────────────
adminRouter.get('/api/admin/engagement', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const { from, to } = parseDateRange(req.query as Record<string, unknown>, 30)
  try {
    const daily = await db
      .select({
        date: sql<string>`date_trunc('day', occurred_at)::date`,
        sessions: sql<number>`count(distinct session_id)`,
        events: count(),
        pageViews: sql<number>`count(*) filter (where event_name = 'page_view')`,
      })
      .from(analyticsEvents)
      .where(and(gte(analyticsEvents.occurredAt, from), lte(analyticsEvents.occurredAt, to)))
      .groupBy(sql`date_trunc('day', occurred_at)::date`)
      .orderBy(asc(sql`date_trunc('day', occurred_at)::date`))
    const [totals] = await db
      .select({
        uniqueSessions: sql<number>`count(distinct session_id)`,
        total: count(),
      })
      .from(analyticsEvents)
      .where(and(gte(analyticsEvents.occurredAt, from), lte(analyticsEvents.occurredAt, to)))
    res.json({ daily, totals })
  } catch (err) {
    logger.error({ err }, 'admin engagement failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── REVENUE ───────────────────────────────────────────────────────────────────
adminRouter.get('/api/admin/revenue', requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const byPlan = await db
      .select({
        plan: teams.plan,
        count: count(),
        estimatedMrr: sql<number>`sum(per_seat_cost_usd)`,
      })
      .from(teams)
      .where(sql`plan IN ('pro', 'business', 'enterprise', 'team', 'growth', 'starter') AND (subscription_status = 'active' OR subscription_status IS NULL)`)
      .groupBy(teams.plan)
    const recentConversions = await db
      .select()
      .from(referralConversions)
      .orderBy(desc(referralConversions.convertedAt))
      .limit(20)
    res.json({ byPlan, recentConversions })
  } catch (err) {
    logger.error({ err }, 'admin revenue failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── MARKETING ─────────────────────────────────────────────────────────────────
adminRouter.get('/api/admin/marketing', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const { from, to } = parseDateRange(req.query as Record<string, unknown>, 30)
  try {
    const pageViews = await db
      .select({
        page: analyticsEvents.page,
        source: analyticsEvents.source,
        views: count(),
        sessions: sql<number>`count(distinct session_id)`,
      })
      .from(analyticsEvents)
      .where(and(
        eq(analyticsEvents.eventName, 'page_view'),
        gte(analyticsEvents.occurredAt, from),
        lte(analyticsEvents.occurredAt, to),
      ))
      .groupBy(analyticsEvents.page, analyticsEvents.source)
      .orderBy(desc(count()))
      .limit(50)
    const topReferrers = await db
      .select({
        referrer: analyticsEvents.referrer,
        sessions: sql<number>`count(distinct session_id)`,
      })
      .from(analyticsEvents)
      .where(and(
        sql`referrer IS NOT NULL AND referrer != ''`,
        gte(analyticsEvents.occurredAt, from),
        lte(analyticsEvents.occurredAt, to),
      ))
      .groupBy(analyticsEvents.referrer)
      .orderBy(desc(sql`count(distinct session_id)`))
      .limit(20)
    const eventBreakdown = await db
      .select({ eventName: analyticsEvents.eventName, c: count() })
      .from(analyticsEvents)
      .where(and(gte(analyticsEvents.occurredAt, from), lte(analyticsEvents.occurredAt, to)))
      .groupBy(analyticsEvents.eventName)
      .orderBy(desc(count()))
    res.json({ pageViews, topReferrers, eventBreakdown })
  } catch (err) {
    logger.error({ err }, 'admin marketing failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── FORMS — CONTACT ───────────────────────────────────────────────────────────
adminRouter.get('/api/admin/forms/contact', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>
  const page = Math.max(1, parseInt(q['page'] ?? '1', 10))
  const limit = Math.min(100, parseInt(q['limit'] ?? '50', 10))
  const status = q['status']
  const offset = (page - 1) * limit
  try {
    const where = status ? eq(contactSubmissions.status, status) : undefined
    const rows = await db
      .select()
      .from(contactSubmissions)
      .where(where)
      .orderBy(desc(contactSubmissions.createdAt))
      .limit(limit)
      .offset(offset)
    const [total] = await db.select({ c: count() }).from(contactSubmissions).where(where)
    res.json({ submissions: rows, total: total?.c ?? 0, page, limit })
  } catch (err) {
    logger.error({ err }, 'admin forms contact failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

adminRouter.patch('/api/admin/forms/contact/:id', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const id = req.params['id']
  if (!id) { res.status(400).json({ error: 'missing_id' }); return }
  const { status, notes } = req.body as { status?: string; notes?: string }
  const validStatuses = ['new', 'replied', 'closed']
  if (status && !validStatuses.includes(status)) {
    res.status(400).json({ error: 'invalid_status' })
    return
  }
  try {
    const updates: Record<string, unknown> = {}
    if (status) updates['status'] = status
    if (notes !== undefined) updates['notes'] = notes
    await db.update(contactSubmissions).set(updates).where(eq(contactSubmissions.id, id))
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'admin forms contact patch failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── FORMS — CAREERS ───────────────────────────────────────────────────────────
adminRouter.get('/api/admin/forms/careers', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>
  const page = Math.max(1, parseInt(q['page'] ?? '1', 10))
  const limit = Math.min(100, parseInt(q['limit'] ?? '50', 10))
  const status = q['status']
  const offset = (page - 1) * limit
  try {
    const where = status ? eq(careerApplications.status, status) : undefined
    const rows = await db
      .select({
        id: careerApplications.id,
        name: careerApplications.name,
        email: careerApplications.email,
        role: careerApplications.role,
        linkedinUrl: careerApplications.linkedinUrl,
        githubUrl: careerApplications.githubUrl,
        portfolioUrl: careerApplications.portfolioUrl,
        message: careerApplications.message,
        hasResume: sql<boolean>`resume_path IS NOT NULL`,
        status: careerApplications.status,
        notes: careerApplications.notes,
        createdAt: careerApplications.createdAt,
      })
      .from(careerApplications)
      .where(where)
      .orderBy(desc(careerApplications.createdAt))
      .limit(limit)
      .offset(offset)
    const [total] = await db.select({ c: count() }).from(careerApplications).where(where)
    res.json({ applications: rows, total: total?.c ?? 0, page, limit })
  } catch (err) {
    logger.error({ err }, 'admin forms careers failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

adminRouter.patch('/api/admin/forms/careers/:id', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const id = req.params['id']
  if (!id) { res.status(400).json({ error: 'missing_id' }); return }
  const { status, notes } = req.body as { status?: string; notes?: string }
  const validStatuses = ['new', 'reviewing', 'interview', 'rejected', 'hired']
  if (status && !validStatuses.includes(status)) {
    res.status(400).json({ error: 'invalid_status' })
    return
  }
  try {
    const updates: Record<string, unknown> = {}
    if (status) updates['status'] = status
    if (notes !== undefined) updates['notes'] = notes
    await db.update(careerApplications).set(updates).where(eq(careerApplications.id, id))
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'admin forms careers patch failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// Signed URL for resume download (10-min expiry, Supabase storage).
adminRouter.get('/api/admin/forms/careers/:id/resume-url', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const id = req.params['id']
  if (!id) { res.status(400).json({ error: 'missing_id' }); return }
  try {
    const [row] = await db
      .select({ resumePath: careerApplications.resumePath })
      .from(careerApplications)
      .where(eq(careerApplications.id, id))
      .limit(1)
    if (!row?.resumePath) { res.status(404).json({ error: 'no_resume' }); return }
    const e = env()
    if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_KEY) {
      res.status(503).json({ error: 'supabase_not_configured' })
      return
    }
    const signUrl = `${e.SUPABASE_URL}/storage/v1/object/sign/career-resumes/${row.resumePath}`
    const response = await fetch(signUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${e.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      // download forces Content-Disposition: attachment so browsers save rather than render.
      body: JSON.stringify({ expiresIn: 600, download: 'resume.pdf' }), // 10 minutes
    })
    if (!response.ok) {
      const text = await response.text()
      logger.error({ status: response.status, text }, 'Supabase signed URL generation failed')
      res.status(502).json({ error: 'supabase_error' })
      return
    }
    const { signedURL } = await response.json() as { signedURL: string }
    res.json({ url: `${e.SUPABASE_URL}/storage/v1${signedURL}` })
  } catch (err) {
    logger.error({ err }, 'admin careers resume-url failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── SYSTEM HEALTH ─────────────────────────────────────────────────────────────
adminRouter.get('/api/admin/system', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const { from } = parseDateRange(req.query as Record<string, unknown>, 7)
  const e = env()
  try {
    // LLM costs by day
    const llmByDay = await db
      .select({
        date: sql<string>`date_trunc('day', created_at)::date`,
        spend: sql<number>`sum(estimated_cost_usd)`,
        calls: count(),
      })
      .from(llmUsageLog)
      .where(gte(llmUsageLog.createdAt, from))
      .groupBy(sql`date_trunc('day', created_at)::date`)
      .orderBy(asc(sql`date_trunc('day', created_at)::date`))
    // Top teams by LLM spend
    const llmByTeam = await db
      .select({ teamId: llmUsageLog.teamId, spend: sql<number>`sum(estimated_cost_usd)`, calls: count() })
      .from(llmUsageLog)
      .where(gte(llmUsageLog.createdAt, from))
      .groupBy(llmUsageLog.teamId)
      .orderBy(desc(sql`sum(estimated_cost_usd)`))
      .limit(10)
    // LLM by model
    const llmByModel = await db
      .select({ model: llmUsageLog.model, spend: sql<number>`sum(estimated_cost_usd)`, calls: count() })
      .from(llmUsageLog)
      .where(gte(llmUsageLog.createdAt, from))
      .groupBy(llmUsageLog.model)
      .orderBy(desc(sql`sum(estimated_cost_usd)`))
    // Webhook health
    const [webhookTotal] = await db
      .select({ c: count() })
      .from(webhookEvents)
      .where(gte(webhookEvents.receivedAt, from))
    const [webhookUnprocessed] = await db
      .select({ c: count() })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.processed, false), gte(webhookEvents.receivedAt, from)))
    // Job queue health
    const [queuePending] = await db
      .select({ c: count() })
      .from(outcomeCheckQueue)
      .where(sql`completed_at IS NULL AND attempts < 5`)
    const [queueFailed] = await db
      .select({ c: count() })
      .from(outcomeCheckQueue)
      .where(sql`completed_at IS NULL AND attempts >= 5`)
    // Recent admin audit log
    const recentAdminActions = await db
      .select()
      .from(adminAuditLog)
      .orderBy(desc(adminAuditLog.occurredAt))
      .limit(50)
    res.json({
      llm: {
        byDay: llmByDay,
        byTeam: llmByTeam,
        byModel: llmByModel,
        caps: {
          dailyCapUsd: e.OPENAI_DAILY_CAP_USD ?? 20,
          monthlyCapUsd: e.OPENAI_MONTHLY_CAP_USD ?? 50,
        },
      },
      webhooks: {
        total: webhookTotal?.c ?? 0,
        unprocessed: webhookUnprocessed?.c ?? 0,
      },
      queue: {
        pending: queuePending?.c ?? 0,
        stuck: queueFailed?.c ?? 0,
      },
      recentAdminActions,
    })
  } catch (err) {
    logger.error({ err }, 'admin system failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── EVENTS EXPLORER ───────────────────────────────────────────────────────────
adminRouter.get('/api/admin/events', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>
  const { from, to } = parseDateRange(q, 7)
  const page = Math.max(1, parseInt(q['page'] ?? '1', 10))
  const limit = Math.min(200, parseInt(q['limit'] ?? '100', 10))
  const offset = (page - 1) * limit
  const source = q['source']
  const eventName = q['event_name']
  const sessionId = q['session_id']
  try {
    const conditions = [
      gte(analyticsEvents.occurredAt, from),
      lte(analyticsEvents.occurredAt, to),
      ...(source ? [eq(analyticsEvents.source, source)] : []),
      ...(eventName ? [eq(analyticsEvents.eventName, eventName)] : []),
      ...(sessionId ? [eq(analyticsEvents.sessionId, sessionId)] : []),
    ]
    const rows = await db
      .select()
      .from(analyticsEvents)
      .where(and(...conditions))
      .orderBy(desc(analyticsEvents.occurredAt))
      .limit(limit)
      .offset(offset)
    const [total] = await db.select({ c: count() }).from(analyticsEvents).where(and(...conditions))
    res.json({ events: rows, total: total?.c ?? 0, page, limit })
  } catch (err) {
    logger.error({ err }, 'admin events failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

const VALID_PLANS = ['trial', 'free', 'pro', 'team', 'growth', 'business', 'enterprise', 'admin'] as const

adminRouter.patch('/api/admin/teams/:teamId/plan', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const { teamId } = req.params as { teamId: string }
  const { plan } = req.body as { plan?: string }
  if (!plan || !(VALID_PLANS as readonly string[]).includes(plan)) {
    res.status(400).json({ error: 'invalid_plan', valid: VALID_PLANS })
    return
  }
  try {
    const [updated] = await db
      .update(teams)
      .set({ plan, updatedAt: new Date() })
      .where(eq(teams.id, teamId))
      .returning({ id: teams.id, plan: teams.plan })
    if (!updated) {
      res.status(404).json({ error: 'team_not_found' })
      return
    }
    logger.info({ teamId, plan, by: req.session!.githubLogin }, 'admin: plan override')
    res.json({ ok: true, teamId: updated.id, plan: updated.plan })
  } catch (err) {
    logger.error({ err }, 'admin plan override failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

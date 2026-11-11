import crypto from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { eq, and, inArray, desc, asc, lt, isNotNull, gte } from 'drizzle-orm'
import {
  teams,
  repos,
  hcPeople,
  hcCodeAreas,
  hcEvidenceEvents,
  hcFailures,
  hcShareTokens,
  hcEvidenceDisputes,
  hcCoverageSnapshots,
  hcUnderstandingAnswers,
  hcBackfillRuns,
  hcCheckRuns,
  pullRequests,
  type HcEvidenceEvent,
  type HcPerson,
  type HcCodeArea,
} from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole, isProOrAbove, isBusinessOrAbove } from '../auth.js'
import { logger } from '../logger.js'

export const hcRouter = Router()

// Public share-link read: 30 req/min per IP to hamper enumeration.
const shareReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
})

function hashShareToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// ── Report computation ────────────────────────────────────────────────────────

interface AreaCoverage {
  activePeople: string[]         // personIds with net positive weight, is_active=true
  inactivePeople: string[]       // personIds with net positive weight, is_active=false
}

function computeAreaCoverage(
  events: HcEvidenceEvent[],
  people: Map<string, HcPerson>,
): Map<string, AreaCoverage> {
  // net weight per area per person
  const netWeights = new Map<string, Map<string, number>>()
  for (const ev of events) {
    let areaMap = netWeights.get(ev.areaId)
    if (!areaMap) { areaMap = new Map(); netWeights.set(ev.areaId, areaMap) }
    areaMap.set(ev.personId, (areaMap.get(ev.personId) ?? 0) + ev.weight)
  }

  const result = new Map<string, AreaCoverage>()
  for (const [areaId, personWeights] of netWeights) {
    const activePeople: string[] = []
    const inactivePeople: string[] = []
    for (const [personId, weight] of personWeights) {
      if (weight <= 0) continue
      const person = people.get(personId)
      if (!person) continue
      if (person.isActive) activePeople.push(personId)
      else inactivePeople.push(personId)
    }
    result.set(areaId, { activePeople, inactivePeople })
  }
  return result
}

async function buildReport(orgId: string, repoId: string) {
  const repoRows = await db
    .select()
    .from(repos)
    .where(and(eq(repos.id, repoId), eq(repos.teamId, orgId)))
    .limit(1)

  const repo = repoRows[0]
  if (!repo) return null

  const [areas, people, failures] = await Promise.all([
    db.select().from(hcCodeAreas)
      .where(and(eq(hcCodeAreas.orgId, orgId), eq(hcCodeAreas.repoId, repoId))),
    db.select().from(hcPeople).where(eq(hcPeople.orgId, orgId)),
    db.select().from(hcFailures)
      .where(and(eq(hcFailures.orgId, orgId), eq(hcFailures.repoId, repoId)))
      .orderBy(desc(hcFailures.createdAt)),
  ])

  const peopleMap = new Map(people.map((p) => [p.id, p]))
  const areaById = new Map(areas.map((a) => [a.id, a]))
  const areaIds = areas.map((a) => a.id)

  let events: HcEvidenceEvent[] = []
  if (areaIds.length > 0) {
    events = await db
      .select()
      .from(hcEvidenceEvents)
      .where(and(eq(hcEvidenceEvents.orgId, orgId), inArray(hcEvidenceEvents.areaId, areaIds)))
      .orderBy(asc(hcEvidenceEvents.occurredAt))
  }

  const coverage = computeAreaCoverage(events, peopleMap)

  // ── Headline ──────────────────────────────────────────────────────────────

  const totalAreas = areas.length
  let darkAreas = 0
  for (const area of areas) {
    const cov = coverage.get(area.id)
    if (!cov || cov.activePeople.length === 0) darkAreas++
  }
  const darkPct = totalAreas > 0 ? Math.round((darkAreas / totalAreas) * 100) : 0

  // Monthly trend: last 6 months — coverage gained vs risk added
  const now = new Date()
  const trend = []
  for (let i = 5; i >= 0; i--) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59))
    const label = monthStart.toISOString().slice(0, 7)

    let aiRisk = 0
    let humanCoverage = 0
    for (const ev of events) {
      const d = new Date(ev.occurredAt)
      if (d < monthStart || d > monthEnd) continue
      if (ev.type === 'large_ai_change_unreviewed') aiRisk++
      else if (ev.weight > 0) humanCoverage++
    }
    trend.push({ month: label, aiRisk, humanCoverage })
  }

  // ── Fragile & dark ────────────────────────────────────────────────────────

  const fragileAndDark = []
  for (const failure of failures) {
    if (failure.state === 'obsolete') continue
    const failureAreas = (failure.areaIds as string[])
      .map((id) => areaById.get(id))
      .filter((a): a is HcCodeArea => a !== undefined)
    const darkOnes = failureAreas.filter((a) => {
      const cov = coverage.get(a.id)
      return !cov || cov.activePeople.length === 0
    })
    if (darkOnes.length === 0) continue
    fragileAndDark.push({
      failure: {
        id: failure.id,
        originalPr: failure.originalPr,
        revertPr: failure.revertPr,
        fixPr: failure.fixPr,
        testNames: failure.testNames as string[],
        state: failure.state,
      },
      areas: darkOnes.map((a) => ({ id: a.id, path: a.path, isCritical: a.isCritical })),
    })
  }

  // ── Single-person areas ───────────────────────────────────────────────────

  const singlePersonAreas = []
  for (const area of areas) {
    const cov = coverage.get(area.id)
    if (!cov || cov.activePeople.length !== 1) continue
    const person = peopleMap.get(cov.activePeople[0]!)
    if (!person) continue
    singlePersonAreas.push({
      areaId: area.id,
      path: area.path,
      isCritical: area.isCritical,
      lastChangedAt: area.lastChangedAt?.toISOString() ?? null,
      person: { githubLogin: person.githubLogin },
    })
  }

  // ── Dark code added per month (AI vs other) ───────────────────────────────

  const darkByMonth = trend.map((t) => ({ month: t.month, ai: t.aiRisk, other: t.humanCoverage }))

  // ── Offboarding view ──────────────────────────────────────────────────────

  const offboarding = []
  for (const area of areas) {
    const cov = coverage.get(area.id)
    if (!cov) continue
    // Only active coverage is absent, but inactive coverage exists
    if (cov.activePeople.length > 0 || cov.inactivePeople.length === 0) continue

    // Find the inactive person whose most recent event on this area is latest
    let latestPerson: HcPerson | null = null
    let latestTime: Date | null = null
    for (const personId of cov.inactivePeople) {
      const person = peopleMap.get(personId)
      if (!person) continue
      const personEvents = events.filter(
        (e) => e.areaId === area.id && e.personId === personId,
      )
      const last = personEvents[personEvents.length - 1]
      if (!last) continue
      const t = new Date(last.occurredAt)
      if (!latestTime || t > latestTime) {
        latestTime = t
        latestPerson = person
      }
    }
    if (!latestPerson) continue
    offboarding.push({
      areaId: area.id,
      path: area.path,
      isCritical: area.isCritical,
      lastPerson: {
        githubLogin: latestPerson.githubLogin,
        leftAt: latestPerson.leftAt?.toISOString() ?? null,
      },
    })
  }

  return {
    repo: { id: repo.id, owner: repo.owner, name: repo.name },
    headline: { totalAreas, darkAreas, darkPct, trend },
    fragileAndDark,
    singlePersonAreas,
    darkByMonth,
    offboarding,
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/hc/:repoId/report
hcRouter.get('/api/hc/:repoId/report', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const { repoId } = req.params as { repoId: string }

  try {
    const [teamRow] = await db
      .select({ plan: teams.plan })
      .from(teams)
      .where(eq(teams.id, sess.teamId))
      .limit(1)

    const plan = teamRow?.plan ?? 'free'
    const isPro = isProOrAbove(plan)

    const report = await buildReport(sess.teamId, repoId)
    if (!report) {
      res.status(404).json({ error: 'repo_not_found' })
      return
    }

    // Free plan: blur all but the top 3 fragile-and-dark areas; hide offboarding view.
    if (!isPro) {
      const FREE_VISIBLE = 3
      const blurredCount = Math.max(0, report.fragileAndDark.length - FREE_VISIBLE)
      return res.json({
        ...report,
        fragileAndDark: report.fragileAndDark.slice(0, FREE_VISIBLE),
        blurredCount,
        offboarding: [],
        planGate: blurredCount > 0 ? 'Upgrade to Pro to see all fragile areas.' : null,
      })
    }

    res.json(report)
  } catch (err) {
    logger.error({ err, repoId, teamId: sess.teamId }, 'hc report build failed')
    res.status(404).json({ error: 'no_data_yet' })
  }
})

// POST /api/hc/:repoId/failures/:failureId/verdict
// body: { verdict: 'confirmed' | 'dismissed' }
// Requires Pro plan.
hcRouter.post(
  '/api/hc/:repoId/failures/:failureId/verdict',
  requireAuth,
  async (req: Request, res: Response) => {
    const sess = req.session!
    const { repoId, failureId } = req.params as { repoId: string; failureId: string }
    const { verdict } = req.body as { verdict?: string }

    const [teamRow] = await db
      .select({ plan: teams.plan })
      .from(teams)
      .where(eq(teams.id, sess.teamId))
      .limit(1)
    if (!isProOrAbove(teamRow?.plan ?? '')) {
      res.status(403).json({ error: 'plan_required', message: 'Failure confirmation requires a Pro plan.' })
      return
    }

    if (verdict !== 'confirmed' && verdict !== 'dismissed') {
      res.status(400).json({ error: 'invalid_verdict', message: 'verdict must be confirmed or dismissed' })
      return
    }

    // Verify repo belongs to team
    const repoRow = await db
      .select({ id: repos.id })
      .from(repos)
      .where(and(eq(repos.id, repoId), eq(repos.teamId, sess.teamId)))
      .limit(1)

    if (!repoRow[0]) {
      res.status(404).json({ error: 'repo_not_found' })
      return
    }

    const newState = verdict === 'confirmed' ? 'confirmed' : 'obsolete'
    const updated = await db
      .update(hcFailures)
      .set({
        state: newState,
        confirmedBy: verdict === 'confirmed' ? sess.githubLogin : null,
        confirmedAt: verdict === 'confirmed' ? new Date() : null,
      })
      .where(
        and(
          eq(hcFailures.id, failureId),
          eq(hcFailures.orgId, sess.teamId),
          eq(hcFailures.repoId, repoId),
        ),
      )
      .returning({ id: hcFailures.id })

    if (!updated[0]) {
      res.status(404).json({ error: 'failure_not_found' })
      return
    }

    res.json({ id: updated[0].id, state: newState })
  },
)

// POST /api/hc/:repoId/share — create a 14-day share token (Pro plan required)
hcRouter.post('/api/hc/:repoId/share', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const { repoId } = req.params as { repoId: string }

  const [teamRow] = await db
    .select({ plan: teams.plan })
    .from(teams)
    .where(eq(teams.id, sess.teamId))
    .limit(1)
  if (!isProOrAbove(teamRow?.plan ?? '')) {
    res.status(403).json({ error: 'plan_required', message: 'Share links require a Pro plan.' })
    return
  }

  const repoRow = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.id, repoId), eq(repos.teamId, sess.teamId)))
    .limit(1)

  if (!repoRow[0]) {
    res.status(404).json({ error: 'repo_not_found' })
    return
  }

  // Expire any existing token for this repo+org first
  await db
    .delete(hcShareTokens)
    .where(and(eq(hcShareTokens.orgId, sess.teamId), eq(hcShareTokens.repoId, repoId)))

  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = hashShareToken(token)
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

  await db.insert(hcShareTokens).values({
    orgId: sess.teamId,
    repoId,
    tokenHash,
    expiresAt,
    createdBy: sess.githubLogin,
  })

  res.json({ token, expiresAt: expiresAt.toISOString() })
})

// ── Dispute endpoints ─────────────────────────────────────────────────────────

// POST /api/hc/:repoId/evidence/:evidenceId/dispute
// Requires Pro plan.
hcRouter.post(
  '/api/hc/:repoId/evidence/:evidenceId/dispute',
  requireAuth,
  async (req: Request, res: Response) => {
    const sess = req.session!
    const { repoId, evidenceId } = req.params as { repoId: string; evidenceId: string }
    const { reason } = req.body as { reason?: string }

    const [teamRow] = await db
      .select({ plan: teams.plan })
      .from(teams)
      .where(eq(teams.id, sess.teamId))
      .limit(1)
    if (!isProOrAbove(teamRow?.plan ?? '')) {
      res.status(403).json({ error: 'plan_required', message: 'Evidence disputes require a Pro plan.' })
      return
    }

    if (!reason || reason.trim().length === 0) {
      res.status(400).json({ error: 'missing_reason' })
      return
    }

    const repoRow = await db
      .select({ id: repos.id })
      .from(repos)
      .where(and(eq(repos.id, repoId), eq(repos.teamId, sess.teamId)))
      .limit(1)
    if (!repoRow[0]) { res.status(404).json({ error: 'repo_not_found' }); return }

    // Verify evidence belongs to this org
    const ev = await db
      .select({ id: hcEvidenceEvents.id })
      .from(hcEvidenceEvents)
      .where(and(eq(hcEvidenceEvents.id, evidenceId), eq(hcEvidenceEvents.orgId, sess.teamId)))
      .limit(1)
    if (!ev[0]) { res.status(404).json({ error: 'evidence_not_found' }); return }

    const [dispute] = await db
      .insert(hcEvidenceDisputes)
      .values({
        orgId: sess.teamId,
        evidenceId,
        reportedBy: sess.githubLogin,
        reason: reason.trim().slice(0, 1000),
        status: 'pending',
      })
      .returning({ id: hcEvidenceDisputes.id, status: hcEvidenceDisputes.status })

    res.status(201).json(dispute)
  },
)

// GET /api/hc/:repoId/disputes — admin: list pending disputes
hcRouter.get('/api/hc/:repoId/disputes', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  if (sess.role !== 'admin' && sess.role !== 'owner') {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const { repoId } = req.params as { repoId: string }

  const repoRow = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.id, repoId), eq(repos.teamId, sess.teamId)))
    .limit(1)
  if (!repoRow[0]) { res.status(404).json({ error: 'repo_not_found' }); return }

  const disputes = await db
    .select()
    .from(hcEvidenceDisputes)
    .where(eq(hcEvidenceDisputes.orgId, sess.teamId))
    .orderBy(desc(hcEvidenceDisputes.createdAt))
    .limit(100)

  res.json(disputes)
})

// PATCH /api/hc/disputes/:disputeId — admin: accept or reject a dispute
hcRouter.patch('/api/hc/disputes/:disputeId', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  if (sess.role !== 'admin' && sess.role !== 'owner') {
    res.status(403).json({ error: 'forbidden' })
    return
  }

  const { disputeId } = req.params as { disputeId: string }
  const { action, adminNote, weightOverride } = req.body as {
    action?: string
    adminNote?: string
    weightOverride?: number
  }

  if (action !== 'accept' && action !== 'reject') {
    res.status(400).json({ error: 'invalid_action', message: 'action must be accept or reject' })
    return
  }

  const disputeRow = await db
    .select()
    .from(hcEvidenceDisputes)
    .where(and(eq(hcEvidenceDisputes.id, disputeId), eq(hcEvidenceDisputes.orgId, sess.teamId)))
    .limit(1)

  if (!disputeRow[0]) { res.status(404).json({ error: 'dispute_not_found' }); return }
  if (disputeRow[0].status !== 'pending') {
    res.status(409).json({ error: 'already_resolved' })
    return
  }

  const newStatus = action === 'accept' ? 'accepted' : 'rejected'
  const [updated] = await db
    .update(hcEvidenceDisputes)
    .set({
      status: newStatus,
      adminNote: adminNote?.trim().slice(0, 1000) ?? null,
      weightOverride: action === 'accept' && typeof weightOverride === 'number' ? weightOverride : null,
      resolvedBy: sess.githubLogin,
      resolvedAt: new Date(),
    })
    .where(eq(hcEvidenceDisputes.id, disputeId))
    .returning()

  // If accepted with a weight override, update the evidence event
  if (action === 'accept' && typeof weightOverride === 'number') {
    await db
      .update(hcEvidenceEvents)
      .set({ weight: weightOverride })
      .where(eq(hcEvidenceEvents.id, disputeRow[0].evidenceId))
  }

  res.json(updated)
})

// GET /api/hc/share/:token — public read-only report via share token
// No requireAuth — intentionally public.
hcRouter.get('/api/hc/share/:token', shareReadLimiter, async (req: Request, res: Response) => {
  const { token } = req.params as { token: string }

  // Clean up expired tokens fire-and-forget — don't block this request on it.
  db.delete(hcShareTokens).where(lt(hcShareTokens.expiresAt, new Date())).catch(() => {})

  const tokenRows = await db
    .select()
    .from(hcShareTokens)
    .where(eq(hcShareTokens.tokenHash, hashShareToken(token)))
    .limit(1)

  const tokenRow = tokenRows[0]
  if (!tokenRow || tokenRow.expiresAt < new Date()) {
    res.status(404).json({ error: 'token_not_found_or_expired' })
    return
  }

  const [shareTeamRow] = await db
    .select({ plan: teams.plan })
    .from(teams)
    .where(eq(teams.id, tokenRow.orgId))
    .limit(1)

  const report = await buildReport(tokenRow.orgId, tokenRow.repoId)
  if (!report) {
    res.status(404).json({ error: 'repo_not_found' })
    return
  }

  // Apply the same plan-gate as the authenticated endpoint.
  const sharePlan = shareTeamRow?.plan ?? 'free'
  const payload = isProOrAbove(sharePlan)
    ? { ...report, expiresAt: tokenRow.expiresAt.toISOString() }
    : {
        ...report,
        fragileAndDark: report.fragileAndDark.slice(0, 3),
        blurredCount: Math.max(0, report.fragileAndDark.length - 3),
        offboarding: [],
        expiresAt: tokenRow.expiresAt.toISOString(),
      }

  // Do NOT echo the token back — it's already in the URL.
  res.json(payload)
})

// DELETE /api/hc/coverage — wipe all HC data for the team (GDPR / privacy)
// Requires owner role. Deletes all 8 HC tables scoped to orgId.
hcRouter.delete(
  '/api/hc/coverage',
  requireAuth,
  requireRole('owner'),
  async (req: Request, res: Response) => {
    const orgId = req.session!.teamId
    try {
      await db.transaction(async (tx) => {
        await tx.delete(hcEvidenceDisputes).where(eq(hcEvidenceDisputes.orgId, orgId))
        await tx.delete(hcCheckRuns).where(eq(hcCheckRuns.orgId, orgId))
        await tx.delete(hcUnderstandingAnswers).where(eq(hcUnderstandingAnswers.orgId, orgId))
        await tx.delete(hcCoverageSnapshots).where(eq(hcCoverageSnapshots.orgId, orgId))
        await tx.delete(hcEvidenceEvents).where(eq(hcEvidenceEvents.orgId, orgId))
        await tx.delete(hcCodeAreas).where(eq(hcCodeAreas.orgId, orgId))
        await tx.delete(hcPeople).where(eq(hcPeople.orgId, orgId))
        await tx.delete(hcBackfillRuns).where(eq(hcBackfillRuns.orgId, orgId))
        await tx.delete(hcShareTokens).where(eq(hcShareTokens.orgId, orgId))
        await tx.delete(hcFailures).where(eq(hcFailures.orgId, orgId))
      })
      logger.info({ orgId }, 'hc coverage data deleted by owner')
      res.json({ ok: true })
    } catch (err) {
      logger.error({ err, orgId }, 'hc coverage delete failed')
      res.status(500).json({ error: 'internal_error' })
    }
  },
)

// ── Enterprise: M&A Readiness Report ─────────────────────────────────────────
// GET /api/hc/ma-report — bus factor, offboarding risk per person, area heat map.
// Business/Enterprise plan required.
hcRouter.get('/api/hc/ma-report', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const [teamRow] = await db
    .select({ plan: teams.plan, name: teams.name })
    .from(teams)
    .where(eq(teams.id, sess.teamId))
    .limit(1)
  if (!teamRow || !isBusinessOrAbove(teamRow.plan)) {
    res.status(403).json({ error: 'plan_required', message: 'M&A Readiness Report requires Business or Enterprise.' })
    return
  }

  const activeRepos = await db
    .select({ id: repos.id, name: repos.name })
    .from(repos)
    .where(and(eq(repos.teamId, sess.teamId), eq(repos.isActive, true)))
  if (activeRepos.length === 0) {
    res.json({ generatedAt: new Date().toISOString(), teamName: teamRow.name, overallHealth: { score: 0, darkPct: 0, singleCoveragePct: 0, wellCoveredPct: 0, busFactor: 0 }, keyRisks: [], areaBreakdown: [] })
    return
  }
  const repoIds = activeRepos.map((r) => r.id)

  const areas = await db
    .select({ id: hcCodeAreas.id, path: hcCodeAreas.path, isCritical: hcCodeAreas.isCritical, repoId: hcCodeAreas.repoId })
    .from(hcCodeAreas)
    .where(and(eq(hcCodeAreas.orgId, sess.teamId), inArray(hcCodeAreas.repoId, repoIds)))
  if (areas.length === 0) {
    res.json({ generatedAt: new Date().toISOString(), teamName: teamRow.name, overallHealth: { score: 0, darkPct: 0, singleCoveragePct: 0, wellCoveredPct: 0, busFactor: 0 }, keyRisks: [], areaBreakdown: [] })
    return
  }
  const areaIds = areas.map((a) => a.id)

  const allPeople = await db
    .select({ id: hcPeople.id, githubLogin: hcPeople.githubLogin, isActive: hcPeople.isActive })
    .from(hcPeople)
    .where(eq(hcPeople.orgId, sess.teamId))
  const activePeopleIds = new Set(allPeople.filter((p) => p.isActive).map((p) => p.id))
  const peopleById = new Map(allPeople.map((p) => [p.id, p]))

  const events = await db
    .select({ areaId: hcEvidenceEvents.areaId, personId: hcEvidenceEvents.personId, weight: hcEvidenceEvents.weight })
    .from(hcEvidenceEvents)
    .where(and(eq(hcEvidenceEvents.orgId, sess.teamId), inArray(hcEvidenceEvents.areaId, areaIds)))

  // Net weight per area per person
  const netWeights = new Map<string, Map<string, number>>()
  for (const ev of events) {
    let m = netWeights.get(ev.areaId)
    if (!m) { m = new Map(); netWeights.set(ev.areaId, m) }
    m.set(ev.personId, (m.get(ev.personId) ?? 0) + ev.weight)
  }

  // Active people with positive weight per area
  const areaActivePeople = new Map<string, string[]>()
  for (const area of areas) {
    const pMap = netWeights.get(area.id) ?? new Map()
    const active = [...pMap.entries()].filter(([pid, w]) => w > 0 && activePeopleIds.has(pid)).map(([pid]) => pid)
    areaActivePeople.set(area.id, active)
  }

  const darkAreas = areas.filter((a) => (areaActivePeople.get(a.id) ?? []).length === 0)
  const singleAreas = areas.filter((a) => (areaActivePeople.get(a.id) ?? []).length === 1)
  const wellAreas = areas.filter((a) => (areaActivePeople.get(a.id) ?? []).length >= 3)
  const darkPct = Math.round((darkAreas.length / areas.length) * 100)
  const singleCoveragePct = Math.round((singleAreas.length / areas.length) * 100)
  const wellCoveredPct = Math.round((wellAreas.length / areas.length) * 100)
  const coverageScore = Math.max(0, 100 - darkPct * 2 - singleCoveragePct)

  // Per-person: areas where they are the SOLE active reviewer
  const personUniqueAreas = new Map<string, { path: string; isCritical: boolean }[]>()
  for (const person of allPeople.filter((p) => p.isActive)) {
    const unique: { path: string; isCritical: boolean }[] = []
    for (const area of areas) {
      const activePeople = areaActivePeople.get(area.id) ?? []
      if (activePeople.length === 1 && activePeople[0] === person.id) {
        unique.push({ path: area.path, isCritical: area.isCritical })
      }
    }
    personUniqueAreas.set(person.id, unique)
  }

  // Bus factor: fewest people whose departure would darken >25% of currently covered areas
  const coveredAreas = areas.filter((a) => (areaActivePeople.get(a.id) ?? []).length > 0)
  const threshold = Math.ceil(coveredAreas.length * 0.25)
  const sortedByImpact = [...personUniqueAreas.entries()]
    .filter(([, u]) => u.length > 0)
    .sort((a, b) => b[1].length - a[1].length)
  let busFactor = 0, cumulative = 0
  for (const [, u] of sortedByImpact) {
    cumulative += u.length; busFactor++
    if (cumulative >= threshold) break
  }
  if (busFactor === 0) busFactor = sortedByImpact.length === 0 ? (coveredAreas.length > 0 ? 999 : 0) : 1

  const keyRisks = [...personUniqueAreas.entries()]
    .filter(([, u]) => u.length > 0)
    .map(([personId, unique]) => {
      const p = peopleById.get(personId)!
      const criticalCount = unique.filter((a) => a.isCritical).length
      return {
        personLogin: p.githubLogin,
        aloneCoversCount: unique.length,
        aloneCoversAreas: unique.slice(0, 20),
        riskLevel: (criticalCount > 0 ? 'HIGH' : unique.length >= 3 ? 'MEDIUM' : 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW',
      }
    })
    .sort((a, b) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.riskLevel] - { HIGH: 0, MEDIUM: 1, LOW: 2 }[b.riskLevel] || b.aloneCoversCount - a.aloneCoversCount))

  const repoNameById = new Map(activeRepos.map((r) => [r.id, r.name]))
  const areaBreakdown = areas.map((area) => {
    const activePeopleLogins = (areaActivePeople.get(area.id) ?? []).map((pid) => peopleById.get(pid)?.githubLogin ?? '?')
    return {
      path: area.path,
      repoName: repoNameById.get(area.repoId) ?? '',
      isCritical: area.isCritical,
      activePeopleCount: activePeopleLogins.length,
      activePeopleLogins,
      riskLevel: activePeopleLogins.length === 0 ? 'DARK' : activePeopleLogins.length === 1 ? 'FRAGILE' : activePeopleLogins.length >= 3 ? 'HEALTHY' : 'AT_RISK',
    }
  })
    .sort((a, b) => (({ DARK: 0, FRAGILE: 1, AT_RISK: 2, HEALTHY: 3 } as Record<string, number>)[a.riskLevel] ?? 99) - (({ DARK: 0, FRAGILE: 1, AT_RISK: 2, HEALTHY: 3 } as Record<string, number>)[b.riskLevel] ?? 99))
    .slice(0, 150)

  res.json({
    generatedAt: new Date().toISOString(),
    teamName: teamRow.name,
    overallHealth: { score: coverageScore, darkPct, singleCoveragePct, wellCoveredPct, busFactor },
    keyRisks,
    areaBreakdown,
  })
})

// ── Enterprise: AI Governance Audit ──────────────────────────────────────────
// GET /api/hc/ai-governance?months=3 — documented human review record for AI-assisted PRs.
// Business/Enterprise plan required.
hcRouter.get('/api/hc/ai-governance', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const [teamRow] = await db
    .select({ plan: teams.plan, name: teams.name })
    .from(teams)
    .where(eq(teams.id, sess.teamId))
    .limit(1)
  if (!teamRow || !isBusinessOrAbove(teamRow.plan)) {
    res.status(403).json({ error: 'plan_required', message: 'AI Governance Audit requires Business or Enterprise.' })
    return
  }

  const months = Math.min(12, Math.max(1, parseInt((req.query as Record<string, string>).months ?? '3', 10)))
  const since = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000)

  const aiPrs = await db
    .select({ id: pullRequests.id, prNumber: pullRequests.githubPrNumber, title: pullRequests.title, authorLogin: pullRequests.authorLogin, aiSource: pullRequests.aiSource, mergedAt: pullRequests.mergedAt, repoId: pullRequests.repoId })
    .from(pullRequests)
    .where(and(eq(pullRequests.teamId, sess.teamId), isNotNull(pullRequests.aiSource), isNotNull(pullRequests.mergedAt), gte(pullRequests.mergedAt, since)))
    .orderBy(desc(pullRequests.mergedAt))
    .limit(500)

  if (aiPrs.length === 0) {
    res.json({ period: { from: since.toISOString(), to: new Date().toISOString(), months }, summary: { totalAiPrs: 0, coveredCount: 0, coveredPct: 100, uncoveredCount: 0, avgReviewerWeight: 0 }, entries: [] })
    return
  }

  const prNumbers = aiPrs.map((pr) => pr.prNumber)
  const repoIds = [...new Set(aiPrs.map((pr) => pr.repoId))]

  const teamPeople = await db
    .select({ id: hcPeople.id, githubLogin: hcPeople.githubLogin })
    .from(hcPeople)
    .where(eq(hcPeople.orgId, sess.teamId))
  const personLoginById = new Map(teamPeople.map((p) => [p.id, p.githubLogin]))

  const answers = await db
    .select({ prNumber: hcUnderstandingAnswers.prNumber, personId: hcUnderstandingAnswers.personId, answer: hcUnderstandingAnswers.answer })
    .from(hcUnderstandingAnswers)
    .where(and(eq(hcUnderstandingAnswers.orgId, sess.teamId), inArray(hcUnderstandingAnswers.prNumber, prNumbers)))

  const reviewEvidence = await db
    .select({ prNumber: hcEvidenceEvents.prNumber, personId: hcEvidenceEvents.personId, weight: hcEvidenceEvents.weight, type: hcEvidenceEvents.type })
    .from(hcEvidenceEvents)
    .where(and(eq(hcEvidenceEvents.orgId, sess.teamId), inArray(hcEvidenceEvents.prNumber, prNumbers)))

  const repoRows = await db
    .select({ id: repos.id, name: repos.name })
    .from(repos)
    .where(inArray(repos.id, repoIds))
  const repoNameById = new Map(repoRows.map((r) => [r.id, r.name]))

  const answersByPr = new Map<number, typeof answers>()
  for (const a of answers) {
    if (!answersByPr.has(a.prNumber)) answersByPr.set(a.prNumber, [])
    answersByPr.get(a.prNumber)!.push(a)
  }
  const evidenceByPr = new Map<number, typeof reviewEvidence>()
  for (const e of reviewEvidence) {
    if (!e.prNumber) continue
    if (!evidenceByPr.has(e.prNumber)) evidenceByPr.set(e.prNumber, [])
    evidenceByPr.get(e.prNumber)!.push(e)
  }

  const entries = aiPrs.map((pr) => {
    const prAnswers = answersByPr.get(pr.prNumber) ?? []
    const prEvidence = evidenceByPr.get(pr.prNumber) ?? []
    const qualifiedLogins = prAnswers.filter((a) => a.answer === 'understand' || a.answer === 'partly').map((a) => personLoginById.get(a.personId) ?? '?')
    const evidenceLogins = [...new Map(prEvidence.filter((e) => e.type === 'substantive_review' && e.weight > 0).map((e) => [e.personId, personLoginById.get(e.personId) ?? '?'])).values()]
    const reviewers = [...new Set([...qualifiedLogins, ...evidenceLogins])]
    const hasQualifiedReview = reviewers.length > 0
    const avgWeight = prEvidence.length > 0 ? Math.round((prEvidence.reduce((s, e) => s + e.weight, 0) / prEvidence.length) * 100) / 100 : 0
    return {
      prNumber: pr.prNumber,
      title: pr.title,
      authorLogin: pr.authorLogin ?? '',
      aiSource: pr.aiSource ?? 'unknown',
      mergedAt: pr.mergedAt?.toISOString() ?? '',
      repoName: repoNameById.get(pr.repoId) ?? '',
      reviewers,
      hasQualifiedReview,
      avgReviewerWeight: avgWeight,
    }
  })

  const coveredCount = entries.filter((e) => e.hasQualifiedReview).length
  const coveredPct = Math.round((coveredCount / aiPrs.length) * 100)
  const weights = entries.map((e) => e.avgReviewerWeight).filter((w) => w > 0)
  const avgReviewerWeight = weights.length > 0 ? Math.round(weights.reduce((s, w) => s + w, 0) / weights.length * 100) / 100 : 0

  res.json({
    period: { from: since.toISOString(), to: new Date().toISOString(), months },
    summary: { totalAiPrs: aiPrs.length, coveredCount, coveredPct, uncoveredCount: aiPrs.length - coveredCount, avgReviewerWeight },
    entries,
  })
})

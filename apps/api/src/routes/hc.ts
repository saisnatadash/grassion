import crypto from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { eq, and, inArray, desc, asc, lt } from 'drizzle-orm'
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
  type HcEvidenceEvent,
  type HcPerson,
  type HcCodeArea,
} from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole, isProOrAbove } from '../auth.js'
import { logger } from '../logger.js'

export const hcRouter = Router()

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
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

  await db.insert(hcShareTokens).values({
    orgId: sess.teamId,
    repoId,
    token,
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
hcRouter.get('/api/hc/share/:token', async (req: Request, res: Response) => {
  const { token } = req.params as { token: string }

  // Clean up expired tokens fire-and-forget — don't block this request on it.
  db.delete(hcShareTokens).where(lt(hcShareTokens.expiresAt, new Date())).catch(() => {})

  const tokenRows = await db
    .select()
    .from(hcShareTokens)
    .where(eq(hcShareTokens.token, token))
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

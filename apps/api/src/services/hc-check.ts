/**
 * GitHub Checks API integration for Human Coverage.
 *
 * Creates a "Grassion Human Coverage" check run on every PR open/synchronize
 * for Pro teams that have hcCheckRunEnabled=true.
 *
 * Privacy rule: only filename is read from PR files — patch is never accessed.
 */

import { eq, and, inArray, sql, desc } from 'drizzle-orm'
import {
  teams,
  repos,
  hcPeople,
  hcCodeAreas,
  hcEvidenceEvents,
  hcFailures,
  hcUnderstandingAnswers,
  hcCheckRuns,
} from '@grassion/db'
import { db } from '../db.js'
import { getInstallationOctokit } from '../github.js'
import { extractAreaPath } from '../jobs/backfillCoverage.js'
import { logger } from '../logger.js'
import { isProOrAbove } from '../auth.js'

// Re-export for webhook handler which imported it from here.
export { isProOrAbove as isProPlan }

type OctokitInstance = Awaited<ReturnType<typeof getInstallationOctokit>>

// ── Coverage lookup ────────────────────────────────────────────────────────────

interface AreaInfo {
  activePeople: Array<{ login: string; weight: number }>
  isCritical: boolean
  hasPastFailure: boolean
  failurePrLinks: Array<{ prNumber: number; testNames: string[] }>
}

async function getAreaInfoForPaths(
  orgId: string,
  repoId: string,
  areaPaths: string[],
): Promise<Map<string, AreaInfo>> {
  const result = new Map<string, AreaInfo>()
  if (areaPaths.length === 0) return result

  const areas = await db
    .select()
    .from(hcCodeAreas)
    .where(and(eq(hcCodeAreas.orgId, orgId), eq(hcCodeAreas.repoId, repoId), inArray(hcCodeAreas.path, areaPaths)))

  const areaIds = areas.map((a) => a.id)
  const areaByPath = new Map(areas.map((a) => [a.path, a]))

  const [events, people, failures] = await Promise.all([
    areaIds.length > 0
      ? db.select().from(hcEvidenceEvents).where(and(eq(hcEvidenceEvents.orgId, orgId), inArray(hcEvidenceEvents.areaId, areaIds)))
      : Promise.resolve([]),
    db.select().from(hcPeople).where(and(eq(hcPeople.orgId, orgId), eq(hcPeople.isActive, true))),
    db.select().from(hcFailures).where(and(eq(hcFailures.orgId, orgId), eq(hcFailures.repoId, repoId))),
  ])

  const peopleMap = new Map(people.map((p) => [p.id, p]))

  // Net weight per area per person
  const netWeights = new Map<string, Map<string, number>>()
  for (const ev of events) {
    let areaMap = netWeights.get(ev.areaId)
    if (!areaMap) { areaMap = new Map(); netWeights.set(ev.areaId, areaMap) }
    areaMap.set(ev.personId, (areaMap.get(ev.personId) ?? 0) + ev.weight)
  }

  for (const path of areaPaths) {
    const area = areaByPath.get(path)
    const activePeople: Array<{ login: string; weight: number }> = []

    if (area) {
      const weights = netWeights.get(area.id)
      if (weights) {
        for (const [personId, weight] of weights) {
          if (weight <= 0) continue
          const person = peopleMap.get(personId)
          if (person) activePeople.push({ login: person.githubLogin, weight })
        }
        activePeople.sort((a, b) => b.weight - a.weight)
      }
    }

    const failurePrLinks: Array<{ prNumber: number; testNames: string[] }> = []
    if (area) {
      for (const f of failures) {
        if (f.state === 'obsolete') continue
        const fAreas = f.areaIds as string[]
        if (fAreas.includes(area.id) && f.originalPr) {
          failurePrLinks.push({ prNumber: f.originalPr, testNames: f.testNames as string[] })
        }
      }
    }

    result.set(path, {
      activePeople,
      isCritical: area?.isCritical ?? false,
      hasPastFailure: failurePrLinks.length > 0,
      failurePrLinks,
    })
  }

  return result
}

// ── Main check run flow ────────────────────────────────────────────────────────

export interface HcCheckInput {
  octokit: OctokitInstance
  owner: string
  repoName: string
  headSha: string
  prNumber: number
  authorLogin: string
  orgId: string
  repoId: string
  maxReviewRequests: number
  blockOnCritical: boolean
  repoUrl: string
}

export async function runHcCheckForPr(input: HcCheckInput): Promise<void> {
  const { octokit, owner, repoName, headSha, prNumber, authorLogin, orgId, repoId, maxReviewRequests, blockOnCritical, repoUrl } = input

  let checkRunId: number
  try {
    const { data } = await octokit.checks.create({
      owner,
      repo: repoName,
      name: 'Grassion Human Coverage',
      head_sha: headSha,
      status: 'in_progress' as const,
      started_at: new Date().toISOString(),
    })
    checkRunId = data.id
  } catch (err) {
    logger.error({ err, prNumber }, 'hc-check: failed to create check run')
    return
  }

  // Upsert (synchronize may replace an earlier check run for the same PR)
  await db
    .insert(hcCheckRuns)
    .values({ orgId, repoId, prNumber, headSha, checkRunId: String(checkRunId) })
    .onConflictDoUpdate({
      target: [hcCheckRuns.orgId, hcCheckRuns.repoId, hcCheckRuns.prNumber],
      set: { checkRunId: String(checkRunId), headSha, conclusion: null },
    })

  // Get PR files — PRIVACY: filename only, patch never accessed. Paginate up to 300 files.
  let filenames: string[]
  try {
    const collected: string[] = []
    for (let filePage = 1; filePage <= 3; filePage++) {
      const { data: files } = await octokit.pulls.listFiles({
        owner,
        repo: repoName,
        pull_number: prNumber,
        per_page: 100,
        page: filePage,
      })
      for (const f of files) collected.push(f.filename) // filename only — patch field intentionally ignored
      if (files.length < 100) break
    }
    filenames = collected
  } catch (err) {
    logger.error({ err, prNumber }, 'hc-check: failed to list PR files')
    await finishCheckRun(octokit, owner, repoName, checkRunId, 'neutral', '⚠️ Could not fetch PR files.', [])
    return
  }

  const areaPaths = [...new Set(filenames.map((f) => extractAreaPath(f)))]
  const coverage = await getAreaInfoForPaths(orgId, repoId, areaPaths)

  // ── Build summary ─────────────────────────────────────────────────────────

  let darkCount = 0
  let criticalDarkCount = 0
  const tableRows: string[] = []
  const reviewerCandidates = new Map<string, number>()

  tableRows.push('| Area | Covered by | Status |')
  tableRows.push('|---|---|---|')

  for (const [path, info] of coverage) {
    const isDark = info.activePeople.length === 0
    if (isDark) { darkCount++; if (info.isCritical) criticalDarkCount++ }

    let badge: string
    if (isDark) badge = info.isCritical ? '🔴 Dark · critical' : '⚫ Dark'
    else if (info.hasPastFailure) badge = '⚠️ Covered · fragile'
    else badge = '✅ Covered'

    const peopleStr = info.activePeople.length > 0
      ? info.activePeople.map((p) => `@${p.login}`).join(', ')
      : '_none_'

    let failureNote = ''
    if (info.failurePrLinks.length > 0) {
      const links = info.failurePrLinks.slice(0, 2).map(
        (f) => `[#${f.prNumber}](${repoUrl}/pull/${f.prNumber})`,
      )
      failureNote = ` · past failures: ${links.join(', ')}`
    }

    tableRows.push(`| \`${path}\` | ${peopleStr} | ${badge}${failureNote} |`)

    for (const p of info.activePeople) {
      if (p.login.toLowerCase() !== authorLogin.toLowerCase()) {
        reviewerCandidates.set(p.login, (reviewerCandidates.get(p.login) ?? 0) + p.weight)
      }
    }
  }

  const headline =
    darkCount === 0
      ? `✅ All ${areaPaths.length} touched areas are covered by a human.`
      : `⚠️ ${darkCount}/${areaPaths.length} touched areas have no human coverage${criticalDarkCount > 0 ? ` · ${criticalDarkCount} critical` : ''}.`

  const conclusion: 'success' | 'action_required' | 'neutral' =
    blockOnCritical && criticalDarkCount > 0
      ? 'action_required'
      : darkCount > 0 ? 'neutral' : 'success'

  const body = [
    headline,
    '',
    '### Coverage breakdown',
    ...tableRows,
    '',
    darkCount > 0
      ? '_These areas have no active human coverage. Consider pairing or review before merging._'
      : '_Advisory only — this check does not block merges unless blocking mode is enabled for critical areas._',
  ].join('\n')

  const actions = [
    { label: 'I understand this', identifier: 'understand', description: 'Fully reviewed the AI-generated changes' },
    { label: 'Partly', identifier: 'partly', description: 'Understand most of it; some gaps remain' },
    { label: "AI wrote it, don't get it", identifier: 'ai_wrote_it', description: "Haven't fully reviewed the AI changes yet" },
  ]

  // ── Request reviewers ─────────────────────────────────────────────────────

  const reviewers = [...reviewerCandidates.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxReviewRequests)
    .map(([login]) => login)

  if (reviewers.length > 0) {
    await octokit.pulls.requestReviewers({ owner, repo: repoName, pull_number: prNumber, reviewers })
      .catch((err) => logger.warn({ err, prNumber, reviewers }, 'hc-check: requestReviewers failed (non-fatal)'))
  }

  // ── Finish check run ──────────────────────────────────────────────────────

  await finishCheckRun(octokit, owner, repoName, checkRunId, conclusion, body, actions)

  await db
    .update(hcCheckRuns)
    .set({ conclusion })
    .where(and(eq(hcCheckRuns.orgId, orgId), eq(hcCheckRuns.repoId, repoId), eq(hcCheckRuns.prNumber, prNumber)))
}

async function finishCheckRun(
  octokit: OctokitInstance,
  owner: string,
  repoName: string,
  checkRunId: number,
  conclusion: string,
  summary: string,
  actions: Array<{ label: string; identifier: string; description: string }>,
): Promise<void> {
  await octokit.checks.update({
    owner,
    repo: repoName,
    check_run_id: checkRunId,
    status: 'completed' as const,
    conclusion: conclusion as 'success' | 'neutral' | 'action_required',
    completed_at: new Date().toISOString(),
    output: { title: summary.split('\n')[0] ?? 'Human Coverage', summary },
    ...(actions.length > 0 ? { actions } : {}),
  }).catch((err) => logger.error({ err, checkRunId }, 'hc-check: finishCheckRun failed'))
}

// ── Understanding answer handler ──────────────────────────────────────────────

export async function handleUnderstandingAction(params: {
  orgId: string
  repoId: string
  installationId: number
  prNumber: number
  senderLogin: string
  actionIdentifier: string
}): Promise<void> {
  const { orgId, repoId, installationId, prNumber, senderLogin, actionIdentifier } = params

  const answer = actionIdentifier === 'understand' ? 'understand'
    : actionIdentifier === 'partly' ? 'partly'
    : 'ai_wrote_it'

  const personRows = await db
    .select({ id: hcPeople.id })
    .from(hcPeople)
    .where(and(eq(hcPeople.orgId, orgId), eq(hcPeople.githubLogin, senderLogin)))
    .limit(1)

  if (!personRows[0]) return // person not in HC data

  const personId = personRows[0].id

  await db
    .insert(hcUnderstandingAnswers)
    .values({ orgId, prNumber, personId, answer })
    .onConflictDoUpdate({
      target: [hcUnderstandingAnswers.personId, hcUnderstandingAnswers.prNumber],
      set: { answer },
    })

  if (answer !== 'ai_wrote_it') return

  // Request the highest-coverage active person who isn't the author.
  const repoRow = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
  const repo = repoRow[0]
  if (!repo) return

  // Rank by total coverage weight in this org so we pick someone who actually knows the codebase.
  const candidates = await db
    .select({
      githubLogin: hcPeople.githubLogin,
      totalWeight: sql<number>`sum(${hcEvidenceEvents.weight})`,
    })
    .from(hcPeople)
    .innerJoin(hcEvidenceEvents, eq(hcEvidenceEvents.personId, hcPeople.id))
    .where(and(eq(hcPeople.orgId, orgId), eq(hcPeople.isActive, true)))
    .groupBy(hcPeople.id, hcPeople.githubLogin)
    .orderBy(desc(sql<number>`sum(${hcEvidenceEvents.weight})`))
    .limit(20)

  const extra = candidates
    .map((p) => p.githubLogin)
    .filter((l) => l.toLowerCase() !== senderLogin.toLowerCase())
    .slice(0, 1)

  if (extra.length === 0) return

  try {
    const octokit = await getInstallationOctokit(installationId)
    await octokit.pulls.requestReviewers({
      owner: repo.owner,
      repo: repo.name,
      pull_number: prNumber,
      reviewers: extra,
    })
  } catch (err) {
    logger.warn({ err, prNumber }, 'hc-check: extra reviewer for ai_wrote_it failed (non-fatal)')
  }
}

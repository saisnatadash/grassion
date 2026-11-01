/**
 * Human Coverage backfill: derives code-area understanding signals from
 * 12 months of merged PR metadata (no source code, no diff patches).
 *
 * Privacy rule: only filename, status, additions, deletions are stored from
 * the GitHub "list pull request files" API. The `patch` field is never read
 * or persisted.
 */

import { eq, and, desc } from 'drizzle-orm'
import {
  repos,
  hcPeople,
  hcCodeAreas,
  hcEvidenceEvents,
  hcFailures,
  hcBackfillRuns,
} from '@grassion/db'
import { db } from '../db.js'
import { getInstallationOctokit } from '../github.js'
import { detectAI } from '../services/ai-detection.js'
import { logger } from '../logger.js'
import {
  EVIDENCE_WEIGHTS,
  extractAreaPath,
  isRevertTitle,
  isHotfixTitle,
  isExplicitFixTitle,
  buildRevertMaps,
  sanitizeFile,
  type ScannedPr,
  type RevertMaps,
  type SafePrFile,
} from './backfillCoverage.helpers.js'

// Re-export pure helpers so callers have a single import point.
export {
  extractAreaPath,
  isRevertTitle,
  isHotfixTitle,
  isExplicitFixTitle,
  buildRevertMaps,
  type ScannedPr,
  type RevertMaps,
}

const LARGE_AI_PR_ADDITIONS_THRESHOLD = 200

// ── Misc ──────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Phase 1: collect all merged PRs (metadata only) ──────────────────────────

type OctokitInstance = Awaited<ReturnType<typeof getInstallationOctokit>>

async function collectAllPrs(
  octokit: OctokitInstance,
  owner: string,
  repoName: string,
  since: Date,
): Promise<ScannedPr[]> {
  const all: ScannedPr[] = []
  let page = 1

  while (true) {
    const res = await octokit.pulls.list({
      owner,
      repo: repoName,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
      page,
    })

    let hitCutoff = false
    for (const pr of res.data) {
      if (!pr.merged_at) continue
      if (new Date(pr.merged_at) < since) {
        hitCutoff = true
        break
      }
      all.push({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? null,
        merged_at: pr.merged_at,
        user: pr.user ? { login: pr.user.login, id: pr.user.id } : null,
        labels: (pr.labels ?? []).map((l) =>
          typeof l === 'string' ? { name: l } : { name: (l as { name: string }).name },
        ),
        additions: (pr as { additions?: number }).additions ?? 0,
        deletions: (pr as { deletions?: number }).deletions ?? 0,
        changed_files: (pr as { changed_files?: number }).changed_files ?? 0,
        commit_count: (pr as { commits?: number }).commits ?? 1,
        html_url: pr.html_url,
      })
    }

    if (hitCutoff || res.data.length < 100) break
    page++
    await sleep(100)
  }

  return all
}

// ── Phase 2: fetch per-PR detail ──────────────────────────────────────────────

interface PrDetail {
  files: SafePrFile[]
  reviews: Array<{
    user: { login: string; id: number } | null
    state: string
    submitted_at: string | null
  }>
  /** ISO timestamps of commits on this PR. */
  commitTimestamps: string[]
  commitMessages: string[]
}

async function fetchPrDetail(
  octokit: OctokitInstance,
  owner: string,
  repoName: string,
  prNumber: number,
): Promise<PrDetail> {
  // Serialised — not concurrent — to stay well within GitHub App secondary rate limits.
  // (3 concurrent calls × N PRs/80ms was ~37 req/s, over the 5 000/hr installation cap.)
  const filesRes = await octokit.pulls.listFiles({ owner, repo: repoName, pull_number: prNumber, per_page: 100 })
  const reviewsRes = await octokit.pulls.listReviews({ owner, repo: repoName, pull_number: prNumber })
  const commitsRes = await octokit.pulls.listCommits({ owner, repo: repoName, pull_number: prNumber })

  // PRIVACY: sanitize every file entry — patch field is stripped here.
  const files = filesRes.data.map((f) => sanitizeFile(f))

  const reviews = reviewsRes.data.map((r) => ({
    user: r.user ? { login: r.user.login, id: r.user.id } : null,
    state: r.state,
    submitted_at: r.submitted_at ?? null,
  }))

  const commits = commitsRes.data
  const commitTimestamps = commits
    .map((c) => c.commit.committer?.date ?? c.commit.author?.date ?? null)
    .filter((d): d is string => d !== null)
  const commitMessages = commits.map((c) => c.commit.message)

  return { files, reviews, commitTimestamps, commitMessages }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function upsertPerson(
  orgId: string,
  login: string,
  githubId: number | null,
): Promise<string> {
  const rows = await db
    .select({ id: hcPeople.id })
    .from(hcPeople)
    .where(and(eq(hcPeople.orgId, orgId), eq(hcPeople.githubLogin, login)))
    .limit(1)

  if (rows[0]) return rows[0].id

  const [ins] = await db
    .insert(hcPeople)
    .values({ orgId, githubLogin: login, githubId: githubId ?? undefined })
    .returning({ id: hcPeople.id })
  return ins!.id
}

async function upsertArea(
  orgId: string,
  repoId: string,
  path: string,
  changedAt: Date,
): Promise<string> {
  const rows = await db
    .select({ id: hcCodeAreas.id })
    .from(hcCodeAreas)
    .where(
      and(
        eq(hcCodeAreas.orgId, orgId),
        eq(hcCodeAreas.repoId, repoId),
        eq(hcCodeAreas.path, path),
      ),
    )
    .limit(1)

  if (rows[0]) {
    await db
      .update(hcCodeAreas)
      .set({ lastChangedAt: changedAt })
      .where(eq(hcCodeAreas.id, rows[0].id))
    return rows[0].id
  }

  const [ins] = await db
    .insert(hcCodeAreas)
    .values({ orgId, repoId, path, lastChangedAt: changedAt })
    .returning({ id: hcCodeAreas.id })
  return ins!.id
}

async function insertEvidence(
  orgId: string,
  personId: string,
  areaId: string,
  type: string,
  occurredAt: Date,
  sourceUrl: string,
  prNumber: number,
): Promise<boolean> {
  const weight = EVIDENCE_WEIGHTS[type] ?? 1.0
  const result = await db
    .insert(hcEvidenceEvents)
    .values({ orgId, personId, areaId, type, weight, occurredAt, sourceUrl, prNumber })
    .onConflictDoNothing()
    .returning({ id: hcEvidenceEvents.id })
  return result.length > 0
}

// ── Evidence classification for one PR ───────────────────────────────────────

interface EvidenceSpec {
  personId: string
  areaId: string
  type: string
  occurredAt: Date
  sourceUrl: string
  prNumber: number
}

async function classifyEvidence(
  orgId: string,
  repoId: string,
  pr: ScannedPr,
  detail: PrDetail,
  maps: RevertMaps,
): Promise<EvidenceSpec[]> {
  if (!pr.merged_at || !pr.user) return []

  const mergedAt = new Date(pr.merged_at)
  const authorLogin = pr.user.login
  const authorGhId = pr.user.id

  const personId = await upsertPerson(orgId, authorLogin, authorGhId)

  const areaPathSet = new Set(detail.files.map((f) => extractAreaPath(f.filename)))
  const areaIds = await Promise.all(
    [...areaPathSet].map((p) => upsertArea(orgId, repoId, p, mergedAt)),
  )

  const specs: EvidenceSpec[] = []

  const isReverted = maps.revertedPrNumbers.has(pr.number)
  const isHotfix = maps.hotfixPrNumbers.has(pr.number)
  const isRevert = isRevertTitle(pr.title)

  const aiResult = detectAI({
    title: pr.title,
    body: pr.body,
    labels: pr.labels.map((l) => l.name),
    commits: detail.commitMessages.map((m) => ({ message: m, author: {} })),
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    commitCount: pr.commit_count,
    openedAt: null,
    mergedAt,
    reviewCount: detail.reviews.length,
  })
  const isAiPr = aiResult.source !== null

  // Reviewers whose CHANGES_REQUESTED review was followed by a new commit
  const reviewerSubstantive = new Set<string>()
  for (const review of detail.reviews) {
    if (!review.user || review.state !== 'CHANGES_REQUESTED' || !review.submitted_at) continue
    const reviewedAt = new Date(review.submitted_at)
    if (detail.commitTimestamps.some((ts) => new Date(ts) > reviewedAt)) {
      reviewerSubstantive.add(review.user.login)
    }
  }

  for (const areaId of areaIds) {
    // Author evidence
    if (isRevert || isHotfix || isExplicitFixTitle(pr.title)) {
      specs.push({
        personId,
        areaId,
        type: 'incident_fix',
        occurredAt: mergedAt,
        sourceUrl: pr.html_url,
        prNumber: pr.number,
      })
    } else if (!isReverted) {
      specs.push({
        personId,
        areaId,
        type: 'successful_edit',
        occurredAt: mergedAt,
        sourceUrl: pr.html_url,
        prNumber: pr.number,
      })
    }

    // Large AI PR with no substantive review — negative signal for author
    if (
      isAiPr &&
      pr.additions >= LARGE_AI_PR_ADDITIONS_THRESHOLD &&
      !reviewerSubstantive.size &&
      !detail.reviews.some((r) => r.state === 'CHANGES_REQUESTED')
    ) {
      specs.push({
        personId,
        areaId,
        type: 'large_ai_change_unreviewed',
        occurredAt: mergedAt,
        sourceUrl: pr.html_url,
        prNumber: pr.number,
      })
    }

    // Reviewer evidence — substantive reviews only
    for (const reviewerLogin of reviewerSubstantive) {
      if (reviewerLogin === authorLogin) continue
      const reviewerPersonId = await upsertPerson(orgId, reviewerLogin, null)
      specs.push({
        personId: reviewerPersonId,
        areaId,
        type: 'substantive_review',
        occurredAt: mergedAt,
        sourceUrl: pr.html_url,
        prNumber: pr.number,
      })
    }
  }

  // Failure candidate for reverted PRs
  if (isReverted) {
    const revertPrNum = maps.revertByOriginal.get(pr.number)
    await db
      .insert(hcFailures)
      .values({
        orgId,
        repoId,
        areaIds: areaIds,
        originalPr: pr.number,
        revertPr: revertPrNum ?? null,
        state: 'candidate',
      })
      .onConflictDoNothing()
  }

  return specs
}

// ── Main export ───────────────────────────────────────────────────────────────

const BACKFILL_MONTHS = 12

/**
 * Runs (or resumes) the Human Coverage backfill for a single repo.
 * Idempotent — safe to call multiple times; evidence events use ON CONFLICT DO NOTHING.
 *
 * @returns the backfill run id
 */
export async function backfillCoverageForRepo(
  repoId: string,
  orgId: string,
  installationId: number,
): Promise<string> {
  const repoRows = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1)
  const repo = repoRows[0]
  if (!repo) throw new Error(`repo not found: ${repoId}`)

  const since = new Date(Date.now() - BACKFILL_MONTHS * 30.44 * 24 * 60 * 60 * 1000)

  // Resume an in-progress run if one exists, otherwise create a new one.
  const existingRun = await db
    .select()
    .from(hcBackfillRuns)
    .where(
      and(
        eq(hcBackfillRuns.repoId, repoId),
        eq(hcBackfillRuns.orgId, orgId),
        eq(hcBackfillRuns.status, 'running'),
      ),
    )
    .orderBy(desc(hcBackfillRuns.createdAt))
    .limit(1)

  let runId: string
  let resumePage: number

  if (existingRun[0]) {
    runId = existingRun[0].id
    resumePage = existingRun[0].lastProcessedPage
    logger.info({ runId, resumePage }, 'hc-backfill: resuming')
  } else {
    const [newRun] = await db
      .insert(hcBackfillRuns)
      .values({ orgId, repoId, status: 'running', sinceDate: since, startedAt: new Date() })
      .returning({ id: hcBackfillRuns.id })
    runId = newRun!.id
    resumePage = 0
    logger.info({ runId, repoId }, 'hc-backfill: starting')
  }

  const octokit = await getInstallationOctokit(installationId)

  try {
    // Phase 1 is always re-run on resume (~10 API calls); it builds the revert maps.
    logger.info({ runId }, 'hc-backfill: phase 1 — collecting PR metadata')
    const allPrs = await collectAllPrs(octokit, repo.owner, repo.name, since)
    const maps = buildRevertMaps(allPrs)
    const mergedPrs = allPrs.filter((p) => p.merged_at !== null)

    logger.info(
      { runId, total: mergedPrs.length, reverted: maps.revertedPrNumbers.size },
      'hc-backfill: phase 1 complete',
    )

    await db
      .update(hcBackfillRuns)
      .set({ prsFetched: mergedPrs.length })
      .where(eq(hcBackfillRuns.id, runId))

    // Phase 2: process per-page, checkpointing after each batch.
    const PAGE_SIZE = 20
    let evidenceCount = 0

    for (let pageIdx = resumePage; pageIdx * PAGE_SIZE < mergedPrs.length; pageIdx++) {
      const batch = mergedPrs.slice(pageIdx * PAGE_SIZE, (pageIdx + 1) * PAGE_SIZE)

      for (const pr of batch) {
        let detail: PrDetail
        try {
          detail = await fetchPrDetail(octokit, repo.owner, repo.name, pr.number)
        } catch (err) {
          logger.warn({ err, prNumber: pr.number }, 'hc-backfill: failed to fetch PR detail, skipping')
          continue
        }

        const specs = await classifyEvidence(orgId, repoId, pr, detail, maps)

        for (const spec of specs) {
          const inserted = await insertEvidence(
            orgId,
            spec.personId,
            spec.areaId,
            spec.type,
            spec.occurredAt,
            spec.sourceUrl,
            spec.prNumber,
          )
          if (inserted) evidenceCount++
        }

        // ~3 sequential calls per PR at ~300 ms apart ≈ 10 calls/sec ≈ 600/min — safe under 5 000/hr cap.
        await sleep(300)
      }

      await db
        .update(hcBackfillRuns)
        .set({ lastProcessedPage: pageIdx + 1, evidenceCreated: evidenceCount })
        .where(eq(hcBackfillRuns.id, runId))

      logger.info(
        { runId, page: pageIdx + 1, prsDone: Math.min((pageIdx + 1) * PAGE_SIZE, mergedPrs.length) },
        'hc-backfill: phase 2 page complete',
      )
    }

    await db
      .update(hcBackfillRuns)
      .set({ status: 'complete', completedAt: new Date(), evidenceCreated: evidenceCount })
      .where(eq(hcBackfillRuns.id, runId))

    logger.info({ runId, evidenceCount }, 'hc-backfill: complete')
    return runId
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db
      .update(hcBackfillRuns)
      .set({ status: 'failed', error: message })
      .where(eq(hcBackfillRuns.id, runId))
    logger.error({ err, runId }, 'hc-backfill: failed')
    throw err
  }
}

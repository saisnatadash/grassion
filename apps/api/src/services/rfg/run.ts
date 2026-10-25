import { eq, and } from 'drizzle-orm'
import { rfgAnalysisRuns, rfgPrLabels, rfgPrFilePaths, repos, teams } from '@grassion/db'
import { db } from '../../db.js'
import { logger } from '../../logger.js'
import { getInstallationOctokit } from '../../github.js'
import type { Octokit } from '@octokit/rest'
import { fetchPrPage, fetchPrDetails, sinceDate } from './ingestion.js'
import { labelPr, type PrSummary } from './labeling.js'

async function getOctokit(teamId: string): Promise<Octokit | null> {
  const teamRow = await db.select({ installationId: teams.githubInstallationId, oauthToken: teams.githubOauthToken })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1)
  const t = teamRow[0]
  if (!t) return null

  if (t.installationId) {
    return getInstallationOctokit(t.installationId) as unknown as Octokit
  }
  if (t.oauthToken) {
    const { Octokit: OctokitCtor } = await import('@octokit/rest')
    return new OctokitCtor({ auth: t.oauthToken })
  }
  return null
}

export async function startRfgRun(repoId: string, teamId: string): Promise<string> {
  const repoRow = await db.select({ owner: repos.owner, name: repos.name })
    .from(repos)
    .where(and(eq(repos.id, repoId), eq(repos.teamId, teamId)))
    .limit(1)

  const repo = repoRow[0]
  if (!repo) throw new Error('repo_not_found')

  const [run] = await db
    .insert(rfgAnalysisRuns)
    .values({
      repoId,
      teamId,
      status: 'running',
      sinceDate: sinceDate(),
      startedAt: new Date(),
    })
    .returning({ id: rfgAnalysisRuns.id })

  const runId = run!.id

  // Fire-and-forget: run the analysis in the background
  runAnalysis(runId, repoId, teamId, repo.owner, repo.name).catch((err) => {
    logger.error({ err, runId }, 'rfg: background analysis failed')
  })

  return runId
}

async function runAnalysis(
  runId: string,
  repoId: string,
  teamId: string,
  owner: string,
  repoName: string,
): Promise<void> {
  const octokit = await getOctokit(teamId)
  if (!octokit) {
    await db.update(rfgAnalysisRuns)
      .set({ status: 'failed', error: 'no_github_auth', completedAt: new Date() })
      .where(eq(rfgAnalysisRuns.id, runId))
    return
  }

  const since = sinceDate()
  let page = 1
  let totalFetched = 0
  // Accumulate all PRs first for cross-referencing revert targets
  const allPrs: PrSummary[] = []

  try {
    // Phase 1: fetch all PR summaries (list endpoint — no per-PR detail calls)
    while (true) {
      const { prs, nextPage } = await fetchPrPage(octokit, owner, repoName, page, since)
      allPrs.push(...prs)
      totalFetched += prs.length

      await db.update(rfgAnalysisRuns)
        .set({ cursor: page, prsFetched: totalFetched })
        .where(eq(rfgAnalysisRuns.id, runId))

      if (!nextPage) break
      page = nextPage
    }

    // Phase 2: fetch file details for each PR and write labels
    for (const pr of allPrs) {
      let details: Awaited<ReturnType<typeof fetchPrDetails>>
      try {
        details = await fetchPrDetails(octokit, owner, repoName, pr.number)
      } catch (err) {
        logger.warn({ err, prNumber: pr.number }, 'rfg: failed to fetch PR details, skipping')
        continue
      }

      const enriched: PrSummary = { ...pr, ...details }
      const result = labelPr(enriched, allPrs)

      const [labelRow] = await db
        .insert(rfgPrLabels)
        .values({
          runId,
          repoId,
          teamId,
          prNumber: enriched.number,
          prTitle: enriched.title,
          prMergedAt: new Date(enriched.mergedAt),
          authorLogin: enriched.authorLogin,
          additions: enriched.additions,
          deletions: enriched.deletions,
          changedFiles: enriched.changedFiles,
          hasTestChanges: result.hasTestChanges,
          label: result.label,
          labelReason: result.reason,
          revertPrNumber: result.revertPrNumber,
          hotfixPrNumber: result.hotfixPrNumber,
        })
        .onConflictDoNothing()
        .returning({ id: rfgPrLabels.id })

      if (labelRow && enriched.files.length > 0) {
        await db.insert(rfgPrFilePaths).values(
          enriched.files.map((f) => ({
            prLabelId: labelRow.id,
            repoId,
            filePath: f.filename,
            additions: f.additions,
            deletions: f.deletions,
          })),
        ).onConflictDoNothing()
      }
    }

    await db.update(rfgAnalysisRuns)
      .set({ status: 'complete', completedAt: new Date(), prsFetched: totalFetched })
      .where(eq(rfgAnalysisRuns.id, runId))

    logger.info({ runId, totalFetched }, 'rfg: analysis complete')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ err, runId }, 'rfg: analysis error')
    await db.update(rfgAnalysisRuns)
      .set({ status: 'failed', error: msg, completedAt: new Date() })
      .where(eq(rfgAnalysisRuns.id, runId))
  }
}

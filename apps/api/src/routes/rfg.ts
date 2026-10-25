import { Router, type Request, type Response } from 'express'
import { eq, and, desc } from 'drizzle-orm'
import { rfgAnalysisRuns, rfgPrLabels, repos } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { logger } from '../logger.js'
import { startRfgRun } from '../services/rfg/run.js'

export const rfgRouter = Router()

// POST /api/rfg/:repoId/analyze
// Starts a new analysis run. Returns immediately with runId and status.
rfgRouter.post('/api/rfg/:repoId/analyze', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const { repoId } = req.params as { repoId: string }

  const repoRow = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.id, repoId), eq(repos.teamId, sess.teamId)))
    .limit(1)

  if (!repoRow[0]) {
    res.status(404).json({ error: 'repo_not_found' })
    return
  }

  // If a run is already in progress, return it instead of starting a second.
  const existing = await db
    .select({ id: rfgAnalysisRuns.id, status: rfgAnalysisRuns.status })
    .from(rfgAnalysisRuns)
    .where(and(eq(rfgAnalysisRuns.repoId, repoId), eq(rfgAnalysisRuns.status, 'running')))
    .limit(1)

  if (existing[0]) {
    res.json({ runId: existing[0].id, status: 'running', already_running: true })
    return
  }

  try {
    const runId = await startRfgRun(repoId, sess.teamId)
    res.status(202).json({ runId, status: 'running' })
  } catch (err) {
    logger.error({ err, repoId }, 'rfg: failed to start run')
    res.status(500).json({ error: 'internal_error' })
  }
})

// GET /api/rfg/:repoId/status
// Returns the latest run status and a summary of labeled PRs.
rfgRouter.get('/api/rfg/:repoId/status', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const { repoId } = req.params as { repoId: string }

  const repoRow = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.id, repoId), eq(repos.teamId, sess.teamId)))
    .limit(1)

  if (!repoRow[0]) {
    res.status(404).json({ error: 'repo_not_found' })
    return
  }

  const runRow = await db
    .select()
    .from(rfgAnalysisRuns)
    .where(eq(rfgAnalysisRuns.repoId, repoId))
    .orderBy(desc(rfgAnalysisRuns.createdAt))
    .limit(1)

  const run = runRow[0]
  if (!run) {
    res.json({ run: null, labels: [] })
    return
  }

  const labels = await db
    .select({
      id: rfgPrLabels.id,
      prNumber: rfgPrLabels.prNumber,
      prTitle: rfgPrLabels.prTitle,
      prMergedAt: rfgPrLabels.prMergedAt,
      authorLogin: rfgPrLabels.authorLogin,
      additions: rfgPrLabels.additions,
      deletions: rfgPrLabels.deletions,
      changedFiles: rfgPrLabels.changedFiles,
      hasTestChanges: rfgPrLabels.hasTestChanges,
      label: rfgPrLabels.label,
      labelReason: rfgPrLabels.labelReason,
      revertPrNumber: rfgPrLabels.revertPrNumber,
      hotfixPrNumber: rfgPrLabels.hotfixPrNumber,
    })
    .from(rfgPrLabels)
    .where(eq(rfgPrLabels.runId, run.id))
    .orderBy(desc(rfgPrLabels.prMergedAt))

  res.json({
    run: {
      id: run.id,
      status: run.status,
      prsFetched: run.prsFetched,
      sinceDate: run.sinceDate?.toISOString() ?? null,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      error: run.error ?? null,
    },
    labels,
  })
})

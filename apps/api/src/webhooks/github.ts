import { Webhooks } from '@octokit/webhooks'
import type { Request, Response } from 'express'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { addDays } from '@grassion/shared'
import { createTeamFromInstallation, deactivateTeam } from '../services/teams.js'
import { connectRepo, disconnectRepo } from '../services/repos.js'
import {
  upsertPRFromWebhook,
  scheduleOutcomeCheck,
  recomputeAIForPR,
  storeCheckRun,
} from '../services/prs.js'
import { backfillTeamRepos } from '../services/backfill.js'
import { db } from '../db.js'
import { teams } from '@grassion/db'
import { eq } from 'drizzle-orm'

let _webhooks: Webhooks | undefined

function getWebhooks(): Webhooks {
  if (!_webhooks) {
    _webhooks = new Webhooks({ secret: env().GITHUB_APP_WEBHOOK_SECRET })

    _webhooks.on('installation.created', async ({ payload }) => {
      const team = await createTeamFromInstallation(payload.installation)
      if (!team) return
      for (const repo of payload.repositories ?? []) {
        await connectRepo(team.id, repo)
      }
      // Trigger backfill (fire and forget — backfill can take minutes for large repos).
      backfillTeamRepos(team.id, payload.installation.id).catch((err) =>
        logger.error({ err, teamId: team.id }, 'backfill error'),
      )
    })

    _webhooks.on('installation.deleted', async ({ payload }) => {
      await deactivateTeam(payload.installation.id)
    })

    _webhooks.on('installation_repositories.added', async ({ payload }) => {
      const installation = payload.installation
      const teamRow = await db
        .select()
        .from(teams)
        .where(eq(teams.githubInstallationId, installation.id))
        .limit(1)
      const team = teamRow[0]
      if (!team) {
        logger.warn({ installationId: installation.id }, 'no team for installation_repositories.added')
        return
      }
      for (const repo of payload.repositories_added ?? []) {
        await connectRepo(team.id, repo)
      }
    })

    _webhooks.on('installation_repositories.removed', async ({ payload }) => {
      for (const repo of payload.repositories_removed ?? []) {
        await disconnectRepo(repo.id)
      }
    })

    _webhooks.on(
      [
        'pull_request.opened',
        'pull_request.edited',
        'pull_request.closed',
        'pull_request.reopened',
        'pull_request.synchronize',
      ],
      async ({ payload }) => {
        const pr = await upsertPRFromWebhook(payload)
        if (
          pr &&
          payload.action === 'closed' &&
          payload.pull_request.merged &&
          payload.pull_request.merged_at
        ) {
          await scheduleOutcomeCheck(pr.id, addDays(new Date(), 7))
        }
      },
    )

    _webhooks.on(['pull_request.labeled', 'pull_request.unlabeled'], async ({ payload }) => {
      // Capture latest PR state (including labels) and re-run detection.
      const pr = await upsertPRFromWebhook(payload)
      if (pr && payload.label?.name.startsWith('grassion:')) {
        await recomputeAIForPR(payload.pull_request.id)
      }
    })

    _webhooks.on('check_run.completed', async ({ payload }) => {
      await storeCheckRun(payload.repository.id, payload.check_run)
    })

    _webhooks.onError((err) => {
      logger.error({ err: err.message }, 'github webhook error')
    })
  }
  return _webhooks
}

export async function handleGithubWebhook(req: Request, res: Response) {
  const id = req.header('x-github-delivery')
  const name = req.header('x-github-event')
  const signature = req.header('x-hub-signature-256')

  if (!id || !name || !signature) {
    res.status(400).json({ error: 'missing required github webhook headers' })
    return
  }

  // The body is a Buffer because we registered express.raw on this route.
  const payload = (req.body as Buffer).toString('utf8')

  try {
    await getWebhooks().verifyAndReceive({ id, name: name as any, signature, payload })
    res.status(202).json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'github webhook verification failed')
    res.status(400).json({ error: 'invalid webhook' })
  }
}

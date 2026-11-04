import crypto from 'node:crypto'
import { Webhooks } from '@octokit/webhooks'
import type { Request, Response } from 'express'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { increment } from '../lib/monitoring.js'
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
import { teams, repos, webhookEvents, hcPeople } from '@grassion/db'
import { eq, and } from 'drizzle-orm'
import { getInstallationOctokit } from '../github.js'
import { sendRevertAlert } from '../lib/slack.js'
import { runHcCheckForPr, handleUnderstandingAction, isProPlan } from '../services/hc-check.js'

let _webhooks: Webhooks | undefined

function getWebhooks(): Webhooks {
  if (!_webhooks) {
    const secret = env().GITHUB_APP_WEBHOOK_SECRET
    if (!secret) throw new Error('GITHUB_APP_WEBHOOK_SECRET not configured')
    _webhooks = new Webhooks({ secret })

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

        // HC check run on open/synchronize (Pro plan + enabled)
        if (pr && (payload.action === 'opened' || payload.action === 'synchronize')) {
          const [teamRow] = await db
            .select({ plan: teams.plan, hcCheckRunEnabled: teams.hcCheckRunEnabled, hcBlockOnCritical: teams.hcBlockOnCritical, hcMaxReviewRequests: teams.hcMaxReviewRequests })
            .from(teams)
            .where(eq(teams.id, pr.teamId))
            .limit(1)

          if (teamRow && isProPlan(teamRow.plan) && teamRow.hcCheckRunEnabled) {
            const installationId = payload.installation?.id
            if (installationId) {
              const [repoRow] = await db
                .select({ id: repos.id })
                .from(repos)
                .where(eq(repos.githubRepoId, payload.repository.id))
                .limit(1)

              if (repoRow) {
                getInstallationOctokit(installationId)
                  .then((octokit) =>
                    runHcCheckForPr({
                      octokit,
                      owner: payload.repository.owner.login,
                      repoName: payload.repository.name,
                      headSha: payload.pull_request.head.sha,
                      prNumber: payload.pull_request.number,
                      authorLogin: payload.pull_request.user?.login ?? '',
                      orgId: pr.teamId,
                      repoId: repoRow.id,
                      maxReviewRequests: teamRow.hcMaxReviewRequests,
                      blockOnCritical: teamRow.hcBlockOnCritical,
                      repoUrl: payload.repository.html_url,
                    }),
                  )
                  .catch((err) => logger.error({ err, prNumber: payload.pull_request.number }, 'hc check run failed'))
              }
            }
          }
        }

        if (
          pr &&
          payload.action === 'closed' &&
          payload.pull_request.merged &&
          payload.pull_request.merged_at
        ) {
          await scheduleOutcomeCheck(pr.id, pr.mergedAt ?? new Date())

          // Clear demo mode when a real PR lands — owner !== 'grassion-demo'
          const [repoRow] = await db
            .select({ owner: repos.owner })
            .from(repos)
            .where(eq(repos.id, pr.repoId))
            .limit(1)
          if (repoRow && repoRow.owner !== 'grassion-demo') {
            await db.update(teams).set({ demoMode: false }).where(eq(teams.id, pr.teamId))
          }

          // Instant Slack alert for reverted PRs (GitHub names them "Revert '...'")
          if (payload.pull_request.title.startsWith('Revert ')) {
            const [team] = await db
              .select({ slackWebhookUrl: teams.slackWebhookUrl })
              .from(teams)
              .where(eq(teams.id, pr.teamId))
              .limit(1)
            if (team?.slackWebhookUrl) {
              const prUrl = payload.pull_request.html_url
              sendRevertAlert(
                team.slackWebhookUrl,
                payload.pull_request.title,
                payload.pull_request.user.login,
                prUrl,
              ).catch((err: unknown) => logger.error({ err }, 'slack revert alert failed'))
            }
          }
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

    // Mark departed org members as inactive so coverage loss alerts fire next 8am cron.
    // Requires the GitHub App to subscribe to the 'organization' webhook event and have
    // 'members: read' permission.
    _webhooks.on('organization.member_removed', async ({ payload }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = payload as any
      const login: string | undefined = p.membership?.user?.login
      const installationId: number | undefined = p.installation?.id
      if (!login || !installationId) return

      const [team] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.githubInstallationId, installationId))
        .limit(1)
      if (!team) return

      await db
        .update(hcPeople)
        .set({ isActive: false, leftAt: new Date() })
        .where(and(eq(hcPeople.orgId, team.id), eq(hcPeople.githubLogin, login)))

      logger.info({ teamId: team.id, login }, 'hc: marked person inactive after org removal')
    })

    _webhooks.on('check_run.completed', async ({ payload }) => {
      await storeCheckRun(payload.repository.id, payload.check_run)
    })

    _webhooks.on('check_run.requested_action', async ({ payload }) => {
      const identifier = payload.requested_action?.identifier
      if (!identifier || !['understand', 'partly', 'ai_wrote_it'].includes(identifier)) return
      if (payload.check_run.name !== 'Grassion Human Coverage') return

      const installationId = payload.installation?.id
      if (!installationId) return

      const [repoRow] = await db
        .select({ id: repos.id, teamId: repos.teamId })
        .from(repos)
        .where(eq(repos.githubRepoId, payload.repository.id))
        .limit(1)
      if (!repoRow) return

      // Extract PR number from check run's pull_request references
      const prRef = (payload.check_run.pull_requests as Array<{ number: number }>)[0]
      if (!prRef) return

      handleUnderstandingAction({
        orgId: repoRow.teamId,
        repoId: repoRow.id,
        installationId,
        prNumber: prRef.number,
        senderLogin: payload.sender.login,
        actionIdentifier: identifier,
      }).catch((err) => logger.error({ err }, 'hc understanding action failed'))
    })

    _webhooks.onError((err) => {
      logger.error({ err: err.message }, 'github webhook error')
    })
  }
  return _webhooks
}

function verifySignature(rawBody: Buffer, signature: string): boolean {
  const secret = env().GITHUB_APP_WEBHOOK_SECRET
  if (!secret) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

export async function handleGithubWebhook(req: Request, res: Response) {
  const deliveryId = req.header('x-github-delivery')
  const name = req.header('x-github-event')
  const signature = req.header('x-hub-signature-256')

  if (!deliveryId || !name || !signature) {
    res.status(400).json({ error: 'missing_github_headers' })
    return
  }

  // Raw body buffer — express.raw middleware is registered for this route.
  const rawBody = req.body as Buffer

  // Manual HMAC-SHA256 verification with timing-safe comparison.
  if (!verifySignature(rawBody, signature)) {
    logger.warn({ deliveryId }, 'github webhook invalid signature')
    increment('webhook_sig_failure')
    res.status(401).json({ error: 'invalid_signature' })
    return
  }

  // Idempotency: try to claim this delivery ID. If another request already
  // processed it (GitHub retry), return 200 immediately without re-processing.
  const inserted = await db
    .insert(webhookEvents)
    .values({ githubDeliveryId: deliveryId })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id })

  if (inserted.length === 0) {
    // Duplicate delivery — already processed.
    res.status(200).json({ ok: true, duplicate: true })
    return
  }

  const payload = rawBody.toString('utf8')

  try {
    await getWebhooks().verifyAndReceive({ id: deliveryId, name: name as never, signature, payload })
    await db
      .update(webhookEvents)
      .set({ processed: true })
      .where(eq(webhookEvents.githubDeliveryId, deliveryId))
    res.status(202).json({ ok: true })
  } catch (err) {
    logger.error({ err, deliveryId }, 'github webhook processing failed')
    res.status(400).json({ error: 'webhook_processing_failed' })
  }
}

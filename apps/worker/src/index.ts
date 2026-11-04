import http from 'node:http'
import cron from 'node-cron'
import { env } from './env.js'
import { logger } from './logger.js'
import { trackAllPendingOutcomes } from './outcome-tracker.js'
import { computeWeeklyMetricsForAllTeams } from './metrics.js'
import { sendDigestsForDueTeams } from './digest-runner.js'
import { sendEmail } from './emails/send.js'
import { startOfWeekUtc, addDays } from '@grassion/shared'
import { closeDb, auditLogs, llmUsageLog, outcomeCheckQueue, webhookEvents, analyticsEvents, careerApplications, teams, lt, lte, and, isNotNull, ne } from '@grassion/db'
import { db } from './db.js'
import { computeBenchmarks } from './benchmarks.js'
import { sendTrialReminderEmails } from './trial-reminder.js'
import { sendDarkCodeDigestForAllProTeams } from './dark-code-digest-runner.js'
import { checkAllTeamsForCoverageLoss } from './coverage-loss-alerts.js'

// ─── Global error safety ────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaughtException — forcing exit')
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection — forcing exit')
  process.exit(1)
})

const e = env()

logger.info({ env: e.NODE_ENV }, 'grassion worker starting')

// ─── Circuit breaker ────────────────────────────────────────────────────────

let consecutiveOutcomeFailures = 0
let outcomePausedUntil = 0
const CIRCUIT_OPEN_THRESHOLD = 3
const CIRCUIT_PAUSE_MS = 60 * 60 * 1000 // 1 hour

async function sendCircuitBreakerAlert(failCount: number) {
  const adminEmail = e.ADMIN_ALERT_EMAIL
  if (!adminEmail) return
  try {
    await sendEmail({
      to: [adminEmail],
      subject: '[Grassion Worker] Circuit breaker tripped',
      text: `The outcome tracker has failed ${failCount} times in a row.\n\nThe worker will pause outcome processing for 1 hour.\n\nCheck worker logs for details.`,
    })
    logger.warn({ adminEmail }, 'circuit breaker alert sent')
  } catch (emailErr) {
    logger.error({ err: emailErr }, 'circuit breaker alert email failed')
  }
}

async function runOutcomePass() {
  if (Date.now() < outcomePausedUntil) {
    const resumeIn = Math.ceil((outcomePausedUntil - Date.now()) / 60_000)
    logger.info({ resumeInMinutes: resumeIn }, 'outcome tracker paused by circuit breaker')
    return
  }

  try {
    await trackAllPendingOutcomes()
    await computeWeeklyMetricsForAllTeams(startOfWeekUtc())
    consecutiveOutcomeFailures = 0
  } catch (err) {
    consecutiveOutcomeFailures++
    logger.error({ err, consecutiveFailures: consecutiveOutcomeFailures }, 'outcome cron failed')

    if (consecutiveOutcomeFailures >= CIRCUIT_OPEN_THRESHOLD) {
      outcomePausedUntil = Date.now() + CIRCUIT_PAUSE_MS
      logger.error(
        { pauseUntil: new Date(outcomePausedUntil).toISOString() },
        'circuit breaker open — pausing outcome tracker for 1 hour',
      )
      consecutiveOutcomeFailures = 0
      await sendCircuitBreakerAlert(CIRCUIT_OPEN_THRESHOLD)
    }
  }
}

// ─── Scheduled jobs ─────────────────────────────────────────────────────────

// Outcome tracking — every 6 hours.
cron.schedule(e.OUTCOME_CRON, () => {
  logger.info('cron: outcome tracker tick')
  runOutcomePass().catch((err) => logger.error({ err }, 'runOutcomePass unexpected error'))
})

// Weekly digest — runs hourly so each team gets it at their configured day/hour.
cron.schedule('0 * * * *', async () => {
  logger.info('cron: weekly digest tick')
  try {
    const lastWeek = addDays(startOfWeekUtc(), -7)
    await computeWeeklyMetricsForAllTeams(lastWeek)
    await sendDigestsForDueTeams()
  } catch (err) {
    logger.error({ err }, 'digest cron failed')
  }
})

// Run an outcome pass immediately on boot so we don't wait up to 6h after a deploy.
runOutcomePass().catch((err) => logger.error({ err }, 'initial outcome pass failed'))

// Weekly data retention — SOC2 data minimisation policy (Sunday 4am UTC).
cron.schedule('0 4 * * 0', async () => {
  logger.info('cron: data retention pass')
  try {
    const now = Date.now()
    const oneYearAgo = new Date(now - 365 * 24 * 60 * 60 * 1000)
    const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)
    const analyticsRetentionMs = e.ANALYTICS_RETENTION_MONTHS * 30 * 24 * 60 * 60 * 1000
    const careerRetentionMs = e.CAREER_APP_RETENTION_MONTHS * 30 * 24 * 60 * 60 * 1000
    const analyticsOlderThan = new Date(now - analyticsRetentionMs)
    const careerOlderThan = new Date(now - careerRetentionMs)

    const [auditDeleted, llmDeleted, queueDeleted, webhookDeleted, analyticsDeleted, careerDeleted, teamsDeleted] =
      await Promise.all([
        db.delete(auditLogs).where(lt(auditLogs.createdAt, oneYearAgo)).returning({ id: auditLogs.id }),
        db.delete(llmUsageLog).where(lt(llmUsageLog.createdAt, ninetyDaysAgo)).returning({ id: llmUsageLog.id }),
        db
          .delete(outcomeCheckQueue)
          .where(and(isNotNull(outcomeCheckQueue.completedAt), lt(outcomeCheckQueue.completedAt, thirtyDaysAgo)))
          .returning({ id: outcomeCheckQueue.id }),
        db.delete(webhookEvents).where(lt(webhookEvents.receivedAt, thirtyDaysAgo)).returning({ id: webhookEvents.id }),
        // Analytics events older than 13 months (configurable).
        db.delete(analyticsEvents).where(lt(analyticsEvents.occurredAt, analyticsOlderThan)).returning({ id: analyticsEvents.id }),
        // Career applications older than 12 months unless marked as hired.
        db
          .delete(careerApplications)
          .where(and(lt(careerApplications.createdAt, careerOlderThan), ne(careerApplications.status, 'hired')))
          .returning({ id: careerApplications.id }),
        // Teams scheduled for deletion (uninstalled GitHub App, 24h grace period).
        db
          .delete(teams)
          .where(and(isNotNull(teams.scheduledDeletionAt), lte(teams.scheduledDeletionAt, new Date())))
          .returning({ id: teams.id }),
      ])

    logger.info(
      {
        auditLogs: auditDeleted.length,
        llmUsageLog: llmDeleted.length,
        outcomeCheckQueue: queueDeleted.length,
        webhookEvents: webhookDeleted.length,
        analyticsEvents: analyticsDeleted.length,
        careerApplications: careerDeleted.length,
        teamsDeleted: teamsDeleted.length,
      },
      'data retention complete',
    )
  } catch (err) {
    logger.error({ err }, 'data retention job failed')
  }
})

// Trial expiry reminder — daily at 10am UTC.
cron.schedule('0 10 * * *', async () => {
  logger.info('cron: trial reminder tick')
  try {
    await sendTrialReminderEmails()
  } catch (err) {
    logger.error({ err }, 'trial reminder cron failed')
  }
}, { timezone: 'UTC' })

// Weekly benchmark recomputation — Monday 5am UTC.
cron.schedule('0 5 * * 1', () => {
  logger.info('cron: benchmark recomputation tick')
  computeBenchmarks().catch((err) => logger.error({ err }, 'benchmark recompute failed'))
}, { timezone: 'UTC' })

// Dark code digest for Pro teams — Monday 9am UTC.
cron.schedule('0 9 * * 1', () => {
  logger.info('cron: dark code digest tick')
  sendDarkCodeDigestForAllProTeams().catch((err) => logger.error({ err }, 'dark code digest failed'))
}, { timezone: 'UTC' })

// Coverage loss alerts — daily 8am UTC.
// Detects areas that just lost all active human coverage (member left, weight decayed to 0)
// and fires Slack + email to team owners/admins. Deduplicates within a 7-day window.
cron.schedule('0 8 * * *', () => {
  logger.info('cron: coverage loss check tick')
  checkAllTeamsForCoverageLoss().catch((err) => logger.error({ err }, 'coverage loss check failed'))
}, { timezone: 'UTC' })

// ─── Health check HTTP server ────────────────────────────────────────────────

const healthServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      circuitBreakerOpen: Date.now() < outcomePausedUntil,
      consecutiveFailures: consecutiveOutcomeFailures,
    }),
  )
})

healthServer.listen(e.WORKER_HEALTH_PORT, '0.0.0.0', () => {
  logger.info({ port: e.WORKER_HEALTH_PORT }, 'worker health check listening')
})

// ─── Heartbeat ───────────────────────────────────────────────────────────────

setInterval(() => {
  logger.debug({ uptimeS: Math.round(process.uptime()) }, 'worker heartbeat')
}, 60_000).unref()

// ─── Graceful shutdown ───────────────────────────────────────────────────────

function shutdown(signal: string) {
  logger.info({ signal }, 'worker shutting down')
  healthServer.close()
  closeDb().finally(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

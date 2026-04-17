import cron from 'node-cron'
import { env } from './env.js'
import { logger } from './logger.js'
import { trackAllPendingOutcomes } from './outcome-tracker.js'
import { computeWeeklyMetricsForAllTeams } from './metrics.js'
import { sendDigestsForDueTeams } from './digest-runner.js'
import { startOfWeekUtc, addDays } from '@grassion/shared'
import { closeDb } from '@grassion/db'

const e = env()

logger.info({ env: e.NODE_ENV }, 'grassion worker starting')

// Outcome tracking — every 6 hours.
cron.schedule(e.OUTCOME_CRON, async () => {
  logger.info('cron: outcome tracker tick')
  try {
    await trackAllPendingOutcomes()
    // Recompute current week's metrics so the dashboard reflects fresh outcomes.
    await computeWeeklyMetricsForAllTeams(startOfWeekUtc())
  } catch (err) {
    logger.error({ err }, 'outcome cron failed')
  }
})

// Weekly digest — runs hourly so each team gets it at their configured day/hour.
// The runner itself filters by today's UTC weekday and tracks idempotency.
cron.schedule('0 * * * *', async () => {
  logger.info('cron: weekly digest tick')
  try {
    // Recompute last week's metrics first (in case any late outcomes landed).
    const lastWeek = addDays(startOfWeekUtc(), -7)
    await computeWeeklyMetricsForAllTeams(lastWeek)
    await sendDigestsForDueTeams()
  } catch (err) {
    logger.error({ err }, 'digest cron failed')
  }
})

// Run an outcome pass immediately on boot so we don't wait up to 6h after a deploy.
trackAllPendingOutcomes().catch((err) => logger.error({ err }, 'initial outcome pass failed'))

// Health check via TCP-less heartbeat (Fly.io can monitor the log stream).
setInterval(() => {
  logger.debug({ uptimeS: Math.round(process.uptime()) }, 'worker heartbeat')
}, 60_000).unref()

function shutdown(signal: string) {
  logger.info({ signal }, 'worker shutting down')
  closeDb().finally(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

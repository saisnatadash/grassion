import { buildApp } from './app.js'
import { env } from './env.js'
import { logger } from './logger.js'
import { closeDb, sessions, lt } from '@grassion/db'
import cron from 'node-cron'
import { runWeeklySlackDigests, runSlackAlertCheck } from './lib/slack.js'
import { db } from './db.js'

const e = env()
const app = buildApp()

const PORT = Number(process.env.PORT) || 3001
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, env: e.NODE_ENV }, 'grassion api listening')
})

// Weekly Slack digest — every Monday 9am IST (3:30 UTC)
cron.schedule('30 3 * * 1', () => {
  runWeeklySlackDigests().catch((err: unknown) => logger.error({ err }, 'weekly slack digest failed'))
}, { timezone: 'UTC' })

// Hourly Slack alert check — health score drops + inactive seats
cron.schedule('0 * * * *', () => {
  runSlackAlertCheck().catch((err: unknown) => logger.error({ err }, 'slack alert check failed'))
}, { timezone: 'UTC' })

// Daily session cleanup — remove expired sessions (SOC2 data hygiene).
cron.schedule('0 3 * * *', async () => {
  try {
    const deleted = await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id })
    if (deleted.length > 0) {
      logger.info({ count: deleted.length }, 'expired sessions purged')
    }
  } catch (err) {
    logger.error({ err }, 'session cleanup failed')
  }
}, { timezone: 'UTC' })

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  server.close(async () => {
    await closeDb()
    process.exit(0)
  })
  // Hard exit if graceful close stalls.
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

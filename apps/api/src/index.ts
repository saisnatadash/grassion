import { buildApp } from './app.js'
import { env } from './env.js'
import { logger } from './logger.js'
import { closeDb } from '@grassion/db'

const e = env()
const app = buildApp()

const server = app.listen(e.PORT, () => {
  logger.info({ port: e.PORT, env: e.NODE_ENV }, 'grassion api listening')
})

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

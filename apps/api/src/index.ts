import { buildApp } from './app.js'
import { env } from './env.js'
import { logger } from './logger.js'
import { closeDb } from '@grassion/db'

const e = env()
const app = buildApp()

const PORT = Number(process.env.PORT) || 3001
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('Server listening on 0.0.0.0:' + PORT)
  logger.info({ port: PORT, env: e.NODE_ENV }, 'grassion api listening')
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

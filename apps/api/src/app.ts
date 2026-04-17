import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { pinoHttp } from 'pino-http'
import { logger } from './logger.js'
import { env } from './env.js'
import { attachSession } from './auth.js'
import { router } from './routes/index.js'
import { handleGithubWebhook } from './webhooks/github.js'
import { handleRazorpayWebhook } from './webhooks/razorpay.js'

export function buildApp() {
  const e = env()
  const app = express()

  app.set('trust proxy', 1)
  app.use(pinoHttp({ logger }))
  app.use(helmet({ crossOriginResourcePolicy: false }))
  app.use(
    cors({
      origin: [e.APP_URL, ...(e.MARKETING_URL ? [e.MARKETING_URL] : [])],
      credentials: true,
    }),
  )

  // Webhook routes need the RAW body for signature verification, so they must
  // be registered BEFORE express.json() — which would otherwise consume the body.
  app.post('/webhooks/github', express.raw({ type: '*/*', limit: '5mb' }), handleGithubWebhook)
  app.post('/webhooks/razorpay', express.raw({ type: '*/*', limit: '2mb' }), handleRazorpayWebhook)

  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use(attachSession)

  app.use(
    '/api/',
    rateLimit({
      windowMs: 60_000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  )

  app.use(router)

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path })
  })

  // Error handler — keep last.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'unhandled express error')
    res.status(500).json({ error: 'internal_error' })
  })

  return app
}

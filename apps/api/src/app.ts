import crypto from 'node:crypto'
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

  // Security headers — explicitly configured for SOC2 alignment.
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
        },
      },
      hsts: {
        maxAge: 31_536_000,
        includeSubDomains: true,
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  )
  // X-XSS-Protection — removed from helmet v7 but still required by many SOC2 scanners.
  app.use((_req, res, next) => {
    res.setHeader('X-XSS-Protection', '1; mode=block')
    next()
  })
  // X-Request-ID — unique ID per request for log correlation.
  app.use((_req, res, next) => {
    res.setHeader('X-Request-ID', crypto.randomUUID())
    next()
  })

  // Public contact endpoint — no cookies needed, allow any origin so the marketing
  // site can POST regardless of whether MARKETING_URL is configured in env.
  app.options('/api/contact', cors())
  app.use('/api/contact', cors())

  // Always allow the canonical production origins so a misconfigured APP_URL /
  // MARKETING_URL env var doesn't silently break CORS and lock users out.
  const allowedOrigins = new Set([
    e.APP_URL.replace(/\/$/, ''),
    ...(e.MARKETING_URL ? [e.MARKETING_URL.replace(/\/$/, '')] : []),
    'https://app.grassion.com',
    'https://grassion.com',
    'https://www.grassion.com',
  ])
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.has(origin)) cb(null, true)
        else cb(new Error(`CORS: origin not allowed: ${origin}`))
      },
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

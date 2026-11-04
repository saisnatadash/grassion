import 'express-async-errors'
import crypto from 'node:crypto'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { pinoHttp } from 'pino-http'
import { logger } from './logger.js'
import { env } from './env.js'
import { attachSession, autoRotateSession } from './auth.js'
import { router } from './routes/index.js'
import { handleGithubWebhook } from './webhooks/github.js'
import { handleRazorpayWebhook } from './webhooks/razorpay.js'
import { increment, captureError } from './lib/monitoring.js'

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
  // Permissions-Policy — disable browser features the API never needs.
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    next()
  })
  // X-Request-ID — unique ID per request for log correlation.
  app.use((_req, res, next) => {
    res.setHeader('X-Request-ID', crypto.randomUUID())
    next()
  })

  // Always allow the canonical production origins so a misconfigured APP_URL /
  // MARKETING_URL env var doesn't silently break CORS and lock users out.
  const allowedOrigins = new Set([
    e.APP_URL.replace(/\/$/, ''),
    ...(e.MARKETING_URL ? [e.MARKETING_URL.replace(/\/$/, '')] : []),
    'https://app.grassion.com',
    'https://grassion.com',
    'https://www.grassion.com',
  ])

  // Public contact/careers/track endpoints — same exact allow-list, no wildcard.
  const publicCors = cors({
    origin: (origin, cb) => {
      // Allow same-origin requests (no Origin header) and listed origins.
      if (!origin || allowedOrigins.has(origin)) cb(null, true)
      else cb(new Error(`CORS: origin not allowed: ${origin}`))
    },
    credentials: false,
  })
  app.options('/api/contact', publicCors)
  app.use('/api/contact', publicCors)
  app.options('/api/careers', publicCors)
  app.use('/api/careers', publicCors)
  app.options('/api/track', publicCors)
  app.use('/api/track', publicCors)
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

  // Slack slash commands: raw body needed for HMAC-SHA256 signature verification.
  app.post('/api/slack/commands', express.raw({ type: 'application/x-www-form-urlencoded', limit: '256kb' }))

  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use(attachSession)
  app.use(autoRotateSession)

  app.use(
    '/api/',
    rateLimit({
      windowMs: 60_000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  )

  // Spike-detection counters — count 401/403 responses after they're sent.
  app.use((_req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode === 401) increment('auth_failure')
      else if (res.statusCode === 403) increment('forbidden')
    })
    next()
  })

  app.use(router)

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path })
  })

  // Error handler — keep last.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    captureError(err, { path: _req.path, method: _req.method })
    res.status(500).json({ error: 'internal_error' })
  })

  return app
}

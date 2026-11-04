import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { analyticsEvents } from '@grassion/db'
import { db } from '../db.js'
import { logger } from '../logger.js'

export const trackRouter = Router()

// Known bot/crawler user-agent substrings (case-insensitive).
// Not exhaustive — just the most common automated crawlers.
const BOT_PATTERNS = [
  'bot', 'crawler', 'spider', 'headless', 'scraper', 'wget', 'curl',
  'python-requests', 'go-http-client', 'libwww', 'facebookexternalhit',
  'twitterbot', 'linkedinbot', 'slackbot', 'discordbot', 'whatsapp',
  'googlebot', 'bingbot', 'yandexbot', 'baiduspider', 'duckduckbot',
]

function isBot(ua: string | undefined): boolean {
  if (!ua) return true
  const lower = ua.toLowerCase()
  return BOT_PATTERNS.some((p) => lower.includes(p))
}

const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? 'unknown',
  message: { error: 'rate_limited' },
})

const eventSchema = z.object({
  session_id: z.string().min(1).max(64),
  event_name: z.string().min(1).max(80),
  source: z.enum(['marketing', 'app']),
  page: z.string().min(1).max(512),
  referrer: z.string().max(512).optional().nullable(),
  team_id: z.string().uuid().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
})

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
})

trackRouter.post('/api/track', trackLimiter, async (req: Request, res: Response) => {
  const ua = req.headers['user-agent']
  if (isBot(ua)) {
    res.json({ ok: true })
    return
  }

  const parsed = batchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' })
    return
  }

  const now = new Date()
  const rows = parsed.data.events.map((e) => ({
    sessionId: e.session_id,
    eventName: e.event_name,
    source: e.source,
    page: e.page,
    referrer: e.referrer ?? null,
    teamId: e.team_id ?? null,
    metadata: e.metadata ?? {},
    occurredAt: now,
  }))

  try {
    await db.insert(analyticsEvents).values(rows)
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'analytics_events insert failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

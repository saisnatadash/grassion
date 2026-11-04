/**
 * Internal monitoring: spike detection, PII scrubbing, and structured error capture.
 *
 * To add Sentry:
 *   1. pnpm add @sentry/node --filter @grassion/api
 *   2. Set SENTRY_DSN in env.ts (already added)
 *   3. Call Sentry.init({ dsn: env().SENTRY_DSN, beforeSend: scrubEvent }) once
 *   4. Replace the logger.error calls here with Sentry.captureException
 */
import { logger } from '../logger.js'

// ─── PII scrubbing ───────────────────────────────────────────────────────────

const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g
const TOKEN_RE = /\b(sk-[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{20,}|rzp_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|Bearer\s+\S+)\b/g
const AUTH_KEYS = new Set(['authorization', 'x-auth-token', 'cookie', 'password', 'secret', 'token', 'access_token', 'refresh_token', 'api_key'])

export function scrubString(s: string): string {
  return s.replace(EMAIL_RE, '[email]').replace(TOKEN_RE, '[token]')
}

export function scrubObject(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return scrubString(obj)
  if (Array.isArray(obj)) return obj.map((v) => scrubObject(v, depth + 1))
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = AUTH_KEYS.has(k.toLowerCase()) ? '[redacted]' : scrubObject(v, depth + 1)
    }
    return out
  }
  return obj
}

// ─── Spike detection ─────────────────────────────────────────────────────────

interface SpikeConfig {
  windowMs: number
  threshold: number
  label: string
}

const SPIKE_CONFIGS: Record<string, SpikeConfig> = {
  auth_failure:        { windowMs: 5 * 60_000,  threshold: 50,  label: '401 auth failure spike' },
  forbidden:           { windowMs: 5 * 60_000,  threshold: 20,  label: '403 forbidden spike' },
  webhook_sig_failure: { windowMs: 5 * 60_000,  threshold: 5,   label: 'webhook signature failure spike' },
  llm_cap_hit:         { windowMs: 60 * 60_000, threshold: 3,   label: 'LLM budget cap spike' },
  job_failure:         { windowMs: 60 * 60_000, threshold: 5,   label: 'worker job failure spike' },
}

// Timestamps of recent events per counter key.
const eventWindows = new Map<string, number[]>()

export function increment(key: string): void {
  const cfg = SPIKE_CONFIGS[key]
  const now = Date.now()

  if (!cfg) {
    // Unknown key — just log at debug; don't track spikes.
    logger.debug({ counter: key }, 'monitoring.increment')
    return
  }

  const times = eventWindows.get(key) ?? []
  // Drop events outside the sliding window.
  const cutoff = now - cfg.windowMs
  const recent = times.filter((t) => t > cutoff)
  recent.push(now)
  eventWindows.set(key, recent)

  if (recent.length === cfg.threshold) {
    logger.warn(
      { counter: key, count: recent.length, windowMs: cfg.windowMs },
      `[alert] ${cfg.label} — ${recent.length} events in ${cfg.windowMs / 60_000} min`,
    )
  }
}

// ─── Error capture ───────────────────────────────────────────────────────────

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  const scrubbed = context ? (scrubObject(context) as Record<string, unknown>) : undefined
  logger.error({ err, ...scrubbed }, 'captureError')
  // TODO: wire Sentry here when SENTRY_DSN is configured:
  //   if (env().SENTRY_DSN) Sentry.captureException(err, { extra: scrubbed })
}

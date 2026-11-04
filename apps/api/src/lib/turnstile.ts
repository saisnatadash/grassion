import type { Request, Response, NextFunction } from 'express'
import { env } from '../env.js'
import { logger } from '../logger.js'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * Middleware: verify the Cloudflare Turnstile token from `cf-turnstile-response` in the
 * request body.  When CF_TURNSTILE_SECRET_KEY is not set the check is skipped (dev default).
 *
 * Frontend must render the Turnstile widget and include the token in the POST body under
 * the field name `cf-turnstile-response`.
 */
export async function verifyTurnstile(req: Request, res: Response, next: NextFunction) {
  const secret = env().CF_TURNSTILE_SECRET_KEY
  if (!secret) {
    next()
    return
  }

  const token = req.body?.['cf-turnstile-response'] as string | undefined
  if (!token) {
    res.status(400).json({ error: 'turnstile_required' })
    return
  }

  try {
    const form = new URLSearchParams({
      secret,
      response: token,
      remoteip: req.ip ?? '',
    })
    const verifyRes = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(5000),
    })
    const data = (await verifyRes.json()) as { success: boolean; 'error-codes'?: string[] }
    if (!data.success) {
      logger.warn({ codes: data['error-codes'], ip: req.ip }, 'turnstile verification failed')
      res.status(400).json({ error: 'turnstile_failed' })
      return
    }
  } catch (err) {
    // On CF outage: fail open (log warning, let the request through).
    logger.warn({ err }, 'turnstile verification request failed — failing open')
  }

  next()
}

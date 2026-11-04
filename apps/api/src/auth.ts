import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { eq, and, gt } from 'drizzle-orm'
import { sessions, users, teams, adminAuditLog } from '@grassion/db'
import { db } from './db.js'
import { env } from './env.js'
import { logger } from './logger.js'

// ── Plan tier helpers ──────────────────────────────────────────────────────────
// Valid plans: free | pro | business | enterprise
// Legacy values (trial | starter | growth) are mapped to their nearest equivalent.

export function isFreePlan(plan: string): boolean {
  return plan === 'free'
}

export function isProOrAbove(plan: string): boolean {
  // 'team' and 'growth' are legacy names for pro-tier plans.
  return plan === 'pro' || plan === 'team' || plan === 'growth' || plan === 'business' || plan === 'enterprise'
}

export function isBusinessOrAbove(plan: string): boolean {
  return plan === 'business' || plan === 'enterprise'
}

export function isEnterprisePlan(plan: string): boolean {
  return plan === 'enterprise'
}

// ── Routes that remain accessible even after a trial expires / on free plan. ──
// Analytics and metrics are read-only — blocking them breaks demo mode.
// Feature gating is enforced per-route for Pro/Business/Enterprise features.
const TRIAL_EXEMPT_PREFIXES = [
  '/auth/',
  '/api/billing',
  '/api/team',
  '/api/repos',
  '/api/notifications',
  '/api/analytics',
  '/api/metrics',
  '/api/prs',
  '/webhooks/',
  '/health',
  '/api/contact',
  '/api/demo',
  '/api/hc',
]

export async function requireActivePlan(req: Request, res: Response, next: NextFunction) {
  const sess = req.session
  if (!sess) { next(); return }

  const path = req.path
  if (TRIAL_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) { next(); return }

  try {
    const row = (
      await db
        .select({ plan: teams.plan, trialEndsAt: teams.trialEndsAt })
        .from(teams)
        .where(eq(teams.id, sess.teamId))
        .limit(1)
    )[0]

    // Legacy: block expired trials. New 'free' plan is always active.
    if (row?.plan === 'trial' && row.trialEndsAt && row.trialEndsAt < new Date()) {
      res.status(402).json({ error: 'trial_expired', message: 'Your free trial has ended. Upgrade to continue.' })
      return
    }
  } catch (err) {
    logger.error({ err }, 'requireActivePlan DB check failed — allowing request through')
  }
  next()
}

const SESSION_COOKIE = 'grassion_session'
const SESSION_TTL_HOURS = 12
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000

export interface SessionUser {
  userId: string
  teamId: string
  githubLogin: string
  role: 'owner' | 'admin' | 'member'
}

declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionUser
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string): Promise<string> {
  const e = env()
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.insert(sessions).values({ userId, tokenHash, expiresAt })

  // Embed the team's plan so the frontend can read feature flags without an extra API call.
  // Security: the JWT is signed — plan is only used for UI gating; all server routes enforce plan server-side.
  const teamRow = await db
    .select({ plan: teams.plan })
    .from(users)
    .innerJoin(teams, eq(teams.id, users.teamId))
    .where(eq(users.id, userId))
    .limit(1)
  const plan = teamRow[0]?.plan ?? 'trial'

  return jwt.sign({ t: token, plan }, e.JWT_SECRET, { expiresIn: '12h', algorithm: 'HS256' })
}

export function setSessionCookie(res: Response, token: string) {
  const e = env()
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: e.NODE_ENV === 'production',
    // SameSite=None required for cross-origin fetch (app.grassion.com → grassion-api.fly.dev).
    // Lax in dev avoids the Secure requirement on http://localhost.
    sameSite: e.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  })
}

export function clearSessionCookie(res: Response) {
  const e = env()
  res.clearCookie(SESSION_COOKIE, {
    path: '/',
    sameSite: e.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: e.NODE_ENV === 'production',
  })
}

async function readSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  const e = env()
  let payload: { t: string }
  try {
    // Pin to HS256 — rejects 'none' and prevents algorithm-confusion attacks.
    payload = jwt.verify(token, e.JWT_SECRET, { algorithms: ['HS256'] }) as { t: string }
  } catch {
    return null
  }
  const tokenHash = hashToken(payload.t)
  const row = await db
    .select({
      userId: users.id,
      teamId: users.teamId,
      githubLogin: users.githubLogin,
      role: users.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1)
  const found = row[0]
  if (!found) return null
  return {
    userId: found.userId,
    teamId: found.teamId,
    githubLogin: found.githubLogin,
    role: found.role as SessionUser['role'],
  }
}

export async function attachSession(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  const token = bearerToken ?? req.cookies?.[SESSION_COOKIE]
  try {
    const sess = await readSession(token)
    if (sess) {
      req.session = sess
    } else if (token) {
      logger.warn({ ip: req.ip, path: req.path }, 'invalid or expired session token rejected')
    }
  } catch (err) {
    logger.error({ err, path: req.path }, 'session lookup failed, treating as unauthenticated')
  }
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session) {
    logger.warn({ ip: req.ip, path: req.path, method: req.method }, 'auth required: no session')
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  next()
}

export function requireRole(...allowed: SessionUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    if (!allowed.includes(req.session.role)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    next()
  }
}

// Pure plan-tier gate — usable in unit tests without DB calls.
export function checkPlanGate(plan: string, minimum: 'pro' | 'business' | 'enterprise'): boolean {
  if (minimum === 'pro') return isProOrAbove(plan)
  if (minimum === 'business') return isBusinessOrAbove(plan)
  return isEnterprisePlan(plan)
}

// Express middleware factory — returns 403 if the authenticated team is below the minimum plan.
export function requirePlan(minimum: 'pro' | 'business' | 'enterprise') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const sess = req.session
    if (!sess) { res.status(401).json({ error: 'unauthorized' }); return }
    try {
      const [row] = await db.select({ plan: teams.plan }).from(teams).where(eq(teams.id, sess.teamId)).limit(1)
      const plan = row?.plan ?? 'free'
      if (!checkPlanGate(plan, minimum)) {
        res.status(403).json({ error: 'plan_required', minimum, current: plan })
        return
      }
    } catch (err) {
      logger.error({ err }, 'requirePlan DB check failed')
      res.status(500).json({ error: 'internal_error' })
      return
    }
    next()
  }
}

export async function loadTeamForSession(teamId: string) {
  const result = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)
  return result[0] ?? null
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE

/** Revoke a session by deleting it from the DB. Silently no-ops on bad/expired tokens. */
export async function deleteSession(rawToken: string): Promise<void> {
  const e = env()
  try {
    const payload = jwt.verify(rawToken, e.JWT_SECRET, { algorithms: ['HS256'] }) as { t?: string }
    if (payload?.t) {
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(payload.t)))
    }
  } catch {
    // Invalid or already-expired token — nothing to revoke
  }
}

/**
 * Sliding-window session rotation: when less than half the TTL remains,
 * issue a new session and revoke the old one. Must run after `attachSession`.
 */
export async function autoRotateSession(req: Request, res: Response, next: NextFunction) {
  const sess = req.session
  if (!sess) { next(); return }

  const authHeader = req.headers.authorization
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  const rawToken = bearerToken ?? req.cookies?.[SESSION_COOKIE]
  if (!rawToken) { next(); return }

  try {
    const decoded = jwt.decode(rawToken) as { t?: string; exp?: number } | null
    if (!decoded?.exp || !decoded?.t) { next(); return }

    const msUntilExpiry = decoded.exp * 1000 - Date.now()
    if (msUntilExpiry > 0 && msUntilExpiry < SESSION_TTL_MS / 2) {
      const oldHash = hashToken(decoded.t)
      const newToken = await createSession(sess.userId)
      setSessionCookie(res, newToken)
      // Revoke old session async — if this fails the old token expires naturally at its TTL
      db.delete(sessions).where(eq(sessions.tokenHash, oldHash)).catch((err) =>
        logger.error({ err }, 'session rotation: revoke old session failed'),
      )
    }
  } catch {
    // rotation failure is non-fatal
  }
  next()
}

// ── Super-admin (founder) gate ────────────────────────────────────────────────
// Returns 404 (not 401/403) so non-admins can't enumerate the existence of admin routes.
// Access is recorded in admin_audit_log before next() is called.
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const sess = req.session
    if (!sess) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    const idsEnv = env().ADMIN_GITHUB_IDS
    if (!idsEnv) {
      logger.warn('ADMIN_GITHUB_IDS not set — all admin routes disabled')
      res.status(404).json({ error: 'not_found' })
      return
    }
    const allowedIds = new Set(idsEnv.split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite))
    try {
      const [userRow] = await db
        .select({ githubUserId: users.githubUserId })
        .from(users)
        .where(eq(users.id, sess.userId))
        .limit(1)
      const githubId = userRow?.githubUserId
      if (!githubId || !allowedIds.has(githubId)) {
        res.status(404).json({ error: 'not_found' })
        return
      }
      // Log every admin access — route path only, no query strings with potential secrets.
      await db.insert(adminAuditLog).values({
        githubLogin: sess.githubLogin,
        githubId,
        method: req.method,
        route: req.path,
        requestSummary: null,
      }).catch((err) => logger.error({ err }, 'admin_audit_log insert failed'))
      next()
    } catch (err) {
      logger.error({ err }, 'requireSuperAdmin DB check failed')
      res.status(500).json({ error: 'internal_error' })
    }
  })()
}

import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { eq, and, gt } from 'drizzle-orm'
import { sessions, users, teams } from '@grassion/db'
import { db } from './db.js'
import { env } from './env.js'

const SESSION_COOKIE = 'grassion_session'
const SESSION_TTL_DAYS = 30

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
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
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

  return jwt.sign({ t: token, plan }, e.JWT_SECRET, { expiresIn: `${SESSION_TTL_DAYS}d` })
}

export function setSessionCookie(res: Response, token: string) {
  const e = env()
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: e.NODE_ENV === 'production',
    // SameSite=None required for cross-origin fetch (app.grassion.com → grassion-api.fly.dev).
    // Lax in dev avoids the Secure requirement on http://localhost.
    sameSite: e.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
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
    payload = jwt.verify(token, e.JWT_SECRET) as { t: string }
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
  const sess = await readSession(token)
  if (sess) req.session = sess
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session) {
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

export async function loadTeamForSession(teamId: string) {
  const result = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)
  return result[0] ?? null
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE

import { Router, type Request, type Response } from 'express'
import { eq } from 'drizzle-orm'
import { teams, users } from '@grassion/db'
import { db } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { createSession, setSessionCookie, clearSessionCookie, requireAuth } from '../auth.js'
import { upsertUser } from '../services/teams.js'

export const authRouter = Router()

const GITHUB_CALLBACK_URL = 'https://grassion-api.fly.dev/auth/github/callback'

authRouter.get('/auth/github', (_req: Request, res: Response) => {
  const e = env()
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', e.GITHUB_APP_CLIENT_ID)
  url.searchParams.set('redirect_uri', GITHUB_CALLBACK_URL)
  url.searchParams.set('scope', 'read:user user:email')
  url.searchParams.set('state', generateState())
  res.redirect(url.toString())
})

authRouter.get('/auth/github/callback', async (req: Request, res: Response) => {
  const code = req.query.code
  if (typeof code !== 'string') {
    res.status(400).json({ error: 'missing code' })
    return
  }
  const e = env()
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: e.GITHUB_APP_CLIENT_ID,
        client_secret: e.GITHUB_APP_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_CALLBACK_URL,
      }),
    })
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string }
    if (!tokenJson.access_token) {
      logger.warn({ tokenJson }, 'github oauth token exchange failed')
      res.status(400).json({ error: 'github oauth failed' })
      return
    }
    const profileRes = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${tokenJson.access_token}`, 'user-agent': 'grassion' },
    })
    const profile = (await profileRes.json()) as {
      id: number
      login: string
      avatar_url?: string
      email?: string | null
    }
    let email = profile.email ?? null
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: { authorization: `Bearer ${tokenJson.access_token}`, 'user-agent': 'grassion' },
      })
      const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>
      const primary = Array.isArray(emails) ? emails.find((x) => x.primary && x.verified) : undefined
      email = primary?.email ?? null
    }

    // Find an existing user record (created by webhook membership flows) or attach to a team.
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.githubUserId, profile.id))
      .limit(1)

    let userRow = existingUser[0]

    if (!userRow) {
      // Try matching a team by GitHub login of the account (best-effort: user may own one).
      const teamMatch = await db
        .select()
        .from(teams)
        .where(eq(teams.githubAccountLogin, profile.login))
        .limit(1)
      if (!teamMatch[0]) {
        // Send them to install flow — no team yet.
        res.redirect(`${e.APP_URL}/install?login=${encodeURIComponent(profile.login)}`)
        return
      }
      userRow = await upsertUser({
        teamId: teamMatch[0].id,
        githubUserId: profile.id,
        githubLogin: profile.login,
        email,
        avatarUrl: profile.avatar_url ?? null,
        role: 'owner',
      })
    } else {
      // Refresh profile.
      userRow = await upsertUser({
        teamId: userRow.teamId,
        githubUserId: profile.id,
        githubLogin: profile.login,
        email,
        avatarUrl: profile.avatar_url ?? null,
      })
    }

    const token = await createSession(userRow.id)
    setSessionCookie(res, token)
    res.redirect(`${e.APP_URL}/auth/callback?token=${encodeURIComponent(token)}`)
  } catch (err) {
    logger.error({ err }, 'github oauth callback failed')
    res.status(500).json({ error: 'oauth_failed' })
  }
})

authRouter.post('/auth/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res)
  res.json({ ok: true })
})

authRouter.get('/auth/me', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const userRow = await db.select().from(users).where(eq(users.id, sess.userId)).limit(1)
  const teamRow = await db.select().from(teams).where(eq(teams.id, sess.teamId)).limit(1)
  const u = userRow[0]
  const t = teamRow[0]
  if (!u || !t) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  res.json({
    user: {
      id: u.id,
      githubLogin: u.githubLogin,
      email: u.email,
      avatarUrl: u.avatarUrl,
      role: u.role,
    },
    team: {
      id: t.id,
      name: t.name,
      slug: t.slug,
      plan: t.plan,
      trialEndsAt: t.trialEndsAt?.toISOString() ?? null,
      githubInstallationId: t.githubInstallationId,
      monthlyAiSpendUsd: t.monthlyAiSpendUsd ?? 0,
      avgDevHourlyRateUsd: t.avgDevHourlyRateUsd ?? 75,
      timezone: t.timezone ?? 'UTC',
      emailDigestEnabled: t.emailDigestEnabled ?? true,
    },
  })
})

function generateState(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

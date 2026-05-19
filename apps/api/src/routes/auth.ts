import { Router, type Request, type Response } from 'express'
import { eq } from 'drizzle-orm'
import { teams, users, type NewTeam } from '@grassion/db'
import { db } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { createSession, setSessionCookie, clearSessionCookie, requireAuth } from '../auth.js'
import { upsertUser, slugify, ensureUniqueSlug } from '../services/teams.js'
import { addDays } from '@grassion/shared'

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
  const state = req.query.state
  const errorParam = req.query.error

  console.log('[auth/github/callback] HIT', {
    code: typeof code === 'string' ? `${code.slice(0, 8)}…` : code,
    state,
    error: errorParam,
    query: req.query,
    redirect_uri_we_will_use: GITHUB_CALLBACK_URL,
  })

  if (errorParam) {
    console.log('[auth/github/callback] GitHub returned error param:', errorParam, req.query.error_description)
    res.status(400).json({ error: String(errorParam), description: req.query.error_description })
    return
  }

  if (typeof code !== 'string') {
    console.log('[auth/github/callback] Missing code param, query was:', req.query)
    res.status(400).json({ error: 'missing code' })
    return
  }

  const e = env()
  console.log('[auth/github/callback] env check — client_id present:', !!e.GITHUB_APP_CLIENT_ID, 'secret present:', !!e.GITHUB_APP_CLIENT_SECRET)

  try {
    console.log('[auth/github/callback] exchanging code for token, redirect_uri =', GITHUB_CALLBACK_URL)
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
    const tokenRaw = await tokenRes.text()
    console.log('[auth/github/callback] GitHub token exchange status:', tokenRes.status, 'body:', tokenRaw)

    let tokenJson: { access_token?: string; error?: string; error_description?: string }
    try {
      tokenJson = JSON.parse(tokenRaw)
    } catch {
      console.log('[auth/github/callback] Failed to parse token response as JSON')
      res.status(500).json({ error: 'oauth_failed', detail: 'non-json token response', raw: tokenRaw })
      return
    }

    if (!tokenJson.access_token) {
      console.log('[auth/github/callback] No access_token in response:', tokenJson)
      logger.warn({ tokenJson }, 'github oauth token exchange failed')
      res.status(400).json({ error: 'github oauth failed', detail: tokenJson.error, description: tokenJson.error_description })
      return
    }

    console.log('[auth/github/callback] Got access_token, fetching profile')
    const profileRes = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${tokenJson.access_token}`, 'user-agent': 'grassion' },
    })
    const profile = (await profileRes.json()) as {
      id: number
      login: string
      avatar_url?: string
      email?: string | null
    }
    console.log('[auth/github/callback] profile:', { id: profile.id, login: profile.login, hasEmail: !!profile.email })

    let email = profile.email ?? null
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: { authorization: `Bearer ${tokenJson.access_token}`, 'user-agent': 'grassion' },
      })
      const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>
      const primary = Array.isArray(emails) ? emails.find((x) => x.primary && x.verified) : undefined
      email = primary?.email ?? null
      console.log('[auth/github/callback] fetched emails, primary:', email)
    }

    // Find an existing user record (created by webhook membership flows) or attach to a team.
    console.log('[auth/github/callback] looking up user by githubUserId:', profile.id)
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.githubUserId, profile.id))
      .limit(1)

    let userRow = existingUser[0]
    console.log('[auth/github/callback] existingUser found:', !!userRow)

    if (!userRow) {
      console.log('[auth/github/callback] no user row — looking up team by login:', profile.login)
      const teamMatch = await db
        .select()
        .from(teams)
        .where(eq(teams.githubAccountLogin, profile.login))
        .limit(1)
      console.log('[auth/github/callback] teamMatch found:', !!teamMatch[0])

      let teamId: string
      if (!teamMatch[0]) {
        // No team exists — auto-create one so the user lands on the dashboard immediately.
        console.log('[auth/github/callback] no team — auto-creating for:', profile.login)
        const slug = await ensureUniqueSlug(slugify(profile.login))
        const insert: NewTeam = {
          name: `${profile.login}'s Team`,
          slug,
          githubAccountLogin: profile.login,
          githubAccountType: 'User',
          plan: 'trial',
          trialEndsAt: addDays(new Date(), 14),
        }
        const [newTeam] = await db.insert(teams).values(insert).returning()
        teamId = newTeam!.id
        console.log('[auth/github/callback] auto-created teamId:', teamId)
      } else {
        teamId = teamMatch[0].id
      }

      userRow = await upsertUser({
        teamId,
        githubUserId: profile.id,
        githubLogin: profile.login,
        email,
        avatarUrl: profile.avatar_url ?? null,
        role: 'owner',
      })
    } else {
      userRow = await upsertUser({
        teamId: userRow.teamId,
        githubUserId: profile.id,
        githubLogin: profile.login,
        email,
        avatarUrl: profile.avatar_url ?? null,
      })
    }

    console.log('[auth/github/callback] upsertUser done, userId:', userRow.id, 'teamId:', userRow.teamId)
    const token = await createSession(userRow.id)
    setSessionCookie(res, token)
    const redirectTo = `${e.APP_URL}/auth/callback?token=${encodeURIComponent(token)}`
    console.log('[auth/github/callback] SUCCESS — redirecting to:', redirectTo.split('?')[0] + '?token=…')
    res.redirect(redirectTo)
  } catch (err) {
    const error = err as Error & { response?: { data?: unknown; status?: number } }
    console.log('[auth/github/callback] CAUGHT ERROR:', {
      message: error.message,
      stack: error.stack,
      responseStatus: error.response?.status,
      responseData: error.response?.data,
    })
    logger.error({ err }, 'github oauth callback failed')
    res.status(500).json({ error: 'oauth_failed', message: error.message })
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

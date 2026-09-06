import { Router, type Request, type Response } from 'express'
import { eq, sql } from 'drizzle-orm'
import { teams, users, type NewTeam } from '@grassion/db'
import { db } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { createSession, setSessionCookie, clearSessionCookie, requireAuth } from '../auth.js'
import { upsertUser, slugify, ensureUniqueSlug, storeTeamOAuthToken } from '../services/teams.js'
import { addDays } from '@grassion/shared'
import { sendWelcomeEmail } from '../lib/email.js'

export const authRouter = Router()

const GITHUB_CALLBACK_URL = 'https://grassion-api.fly.dev/auth/github/callback'

authRouter.get('/auth/github', (_req: Request, res: Response) => {
  const e = env()
  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize')
  githubAuthUrl.searchParams.set('client_id', e.GITHUB_APP_CLIENT_ID)
  githubAuthUrl.searchParams.set('redirect_uri', GITHUB_CALLBACK_URL)
  // `repo` lets the OAuth-token fallback list/read private repos when the
  // GitHub App isn't installed yet. GitHub App-type client IDs ignore `scope`.
  githubAuthUrl.searchParams.set('scope', 'read:user user:email repo')
  githubAuthUrl.searchParams.set('state', generateState())
  res.redirect(githubAuthUrl.toString())
})

authRouter.get('/auth/github/callback', async (req: Request, res: Response) => {
  const e = env()
  const errorRedirect = `${e.APP_URL}/login?error=auth_failed`

  const code = req.query.code
  const errorParam = req.query.error

  if (errorParam) {
    logger.warn({ error: errorParam }, 'github oauth returned error')
    res.redirect(`${errorRedirect}&reason=github_error`)
    return
  }

  if (typeof code !== 'string') {
    res.redirect(`${errorRedirect}&reason=missing_code`)
    return
  }

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
    const tokenRaw = await tokenRes.text()

    let tokenJson: { access_token?: string; error?: string; error_description?: string }
    try {
      tokenJson = JSON.parse(tokenRaw)
    } catch {
      logger.error({ status: tokenRes.status }, 'github token response not json')
      res.redirect(`${errorRedirect}&reason=token_parse`)
      return
    }

    if (!tokenJson.access_token) {
      logger.warn({ tokenJson }, 'github oauth token exchange failed')
      res.redirect(`${errorRedirect}&reason=token_exchange`)
      return
    }

    const profileRes = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${tokenJson.access_token}`, 'user-agent': 'grassion' },
    })
    if (!profileRes.ok) {
      logger.error({ status: profileRes.status }, 'github profile fetch failed')
      res.redirect(`${errorRedirect}&reason=profile_fetch`)
      return
    }
    const profile = (await profileRes.json()) as {
      id: number
      login: string
      avatar_url?: string
      email?: string | null
    }
    if (typeof profile.id !== 'number' || !profile.login) {
      logger.error({ profile }, 'github profile missing id/login')
      res.redirect(`${errorRedirect}&reason=profile_fetch`)
      return
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

    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.githubUserId, profile.id))
      .limit(1)

    let userRow = existingUser[0]

    if (!userRow) {
      try {
        // Prefer a team that already owns an App installation (created by the
        // installation webhook) over a bare sign-in team with the same login.
        const teamMatch = await db
          .select()
          .from(teams)
          .where(eq(teams.githubAccountLogin, profile.login))
          .orderBy(sql`${teams.githubInstallationId} IS NULL`)
          .limit(1)

        let teamId: string
        if (!teamMatch[0]) {
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
      } catch (err) {
        logger.error({ err, login: profile.login }, 'team auto-creation failed during oauth callback')
        res.redirect(`${errorRedirect}&reason=team_create`)
        return
      }

      if (email) {
        sendWelcomeEmail(email, profile.login).catch((err) => {
          logger.warn({ err, email }, 'welcome email failed')
        })
      }
    } else {
      userRow = await upsertUser({
        teamId: userRow.teamId,
        githubUserId: profile.id,
        githubLogin: profile.login,
        email,
        avatarUrl: profile.avatar_url ?? null,
      })
    }

    // Non-fatal: if the column migration hasn't run yet, login must still succeed.
    try {
      await storeTeamOAuthToken(userRow.teamId, tokenJson.access_token)
    } catch (err) {
      logger.warn({ err, teamId: userRow.teamId }, 'failed to store github oauth token')
    }

    const token = await createSession(userRow.id)
    setSessionCookie(res, token)

    logger.info({ login: profile.login }, 'github oauth success')
    res.redirect(`${e.APP_URL}/auth/callback?token=${encodeURIComponent(token)}`)
  } catch (err) {
    logger.error({ err }, 'github oauth callback failed')
    res.redirect(`${errorRedirect}&reason=exception`)
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

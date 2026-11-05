import crypto from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { eq, sql, and, ilike } from 'drizzle-orm'
import { teams, users, referralCodes, type NewTeam } from '@grassion/db'
import { db } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { createSession, setSessionCookie, clearSessionCookie, requireAuth, deleteSession, SESSION_COOKIE_NAME } from '../auth.js'
import { upsertUser, slugify, ensureUniqueSlug, storeTeamOAuthToken } from '../services/teams.js'
import { addDays } from '@grassion/shared'
import { sendWelcomeEmail } from '../lib/email.js'
import { logAuditEvent, getIp } from '../services/audit.js'

const OAUTH_STATE_COOKIE = 'grassion_oauth_state'

// 20 login initiations per IP per hour — prevents OAuth redirect abuse.
const oauthInitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
})

// Callback has the same window; GitHub retries are uncommon.
const oauthCallbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
})

export const authRouter = Router()

function getCallbackUrl() {
  return `${env().API_URL.replace(/\/$/, '')}/auth/github/callback`
}

authRouter.get('/auth/github', oauthInitLimiter, (req: Request, res: Response) => {
  const e = env()
  // Read referral code from ?ref= query param, falling back to grassion_ref cookie
  const ref = (req.query.ref as string | undefined) ?? (req.cookies.grassion_ref as string | undefined) ?? ''
  const force = req.query.force === 'true' || req.query.force === '1'
  const state = generateState(ref || undefined)

  // Store state in a short-lived cookie for CSRF verification on callback.
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: e.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000, // 10 minutes — enough for the OAuth round-trip
    path: '/',
  })

  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize')
  githubAuthUrl.searchParams.set('client_id', e.GITHUB_APP_CLIENT_ID)
  githubAuthUrl.searchParams.set('redirect_uri', getCallbackUrl())
  // Minimum scopes: identity + primary email only.
  // Repo access comes exclusively from the GitHub App installation, never OAuth tokens.
  githubAuthUrl.searchParams.set('scope', 'read:user user:email')
  githubAuthUrl.searchParams.set('state', state)
  // Passing login= empty forces GitHub to show the account chooser / login page
  // instead of silently re-using the existing GitHub session.
  if (force) githubAuthUrl.searchParams.set('login', '')
  res.redirect(githubAuthUrl.toString())
})

authRouter.get('/auth/github/callback', oauthCallbackLimiter, async (req: Request, res: Response) => {
  const e = env()
  const appUrl = e.APP_URL.replace(/\/$/, '')
  const errorRedirect = `${appUrl}/login?error=auth_failed`

  // ── CSRF: verify state matches the cookie set in /auth/github ──────────────
  const expectedState = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined
  const receivedState = typeof req.query.state === 'string' ? req.query.state : ''
  // Always clear the state cookie regardless of outcome — prevents replay
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' })
  if (!expectedState || receivedState !== expectedState) {
    logger.warn({ ip: req.ip }, 'oauth state mismatch — possible CSRF')
    res.redirect(`${errorRedirect}&reason=state_mismatch`)
    return
  }

  // Extract referral code embedded in verified OAuth state as "nonce:ref"
  const colonIdx = receivedState.indexOf(':')
  const refCode = colonIdx >= 0 ? receivedState.slice(colonIdx + 1).trim() : ''

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
    const abort = new AbortController()
    const abortTimer = setTimeout(() => abort.abort(), 25_000)
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      signal: abort.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: e.GITHUB_APP_CLIENT_ID,
        client_secret: e.GITHUB_APP_CLIENT_SECRET,
        code,
        redirect_uri: getCallbackUrl(),
      }),
    })
    clearTimeout(abortTimer)
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
      logger.warn({ error: tokenJson.error, error_description: tokenJson.error_description }, 'github oauth token exchange failed')
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
      let _signupStep = 'start'
      try {
        // Prefer a team that already owns an App installation (created by the
        // installation webhook) over a bare sign-in team with the same login.
        // Select only stable columns — avoids "column does not exist" if a
        // schema migration hasn't been applied yet on this DB instance.
        _signupStep = 'teamSelect'
        const teamMatch = await db
          .select({
            id: teams.id,
            githubInstallationId: teams.githubInstallationId,
          })
          .from(teams)
          .where(eq(teams.githubAccountLogin, profile.login))
          .orderBy(sql`${teams.githubInstallationId} IS NULL`)
          .limit(1)

        let teamId: string
        if (!teamMatch[0]) {
          _signupStep = 'slugGen'
          const slug = await ensureUniqueSlug(slugify(profile.login))
          const insert: NewTeam = {
            name: `${profile.login}'s Team`,
            slug,
            githubAccountLogin: profile.login,
            githubAccountType: 'User',
            plan: 'trial',
            trialEndsAt: addDays(new Date(), 14),
          }
          _signupStep = 'teamInsert'
          // Narrow RETURNING to only id — avoids "column does not exist" if
          // schema migrations are behind (same defence as the SELECT above).
          const [newTeam] = await db.insert(teams).values(insert).returning({ id: teams.id })
          teamId = newTeam!.id

          // Apply referral code if one was passed through the OAuth state
          if (refCode) {
            _signupStep = 'refCode'
            const refRow = (
              await db
                .select({ id: referralCodes.id, code: referralCodes.code })
                .from(referralCodes)
                .where(and(ilike(referralCodes.code, refCode), eq(referralCodes.isActive, true)))
                .limit(1)
            )[0]
            if (refRow) {
              await db
                .update(teams)
                .set({ referralCode: refRow.code, referralCodeId: refRow.id, updatedAt: new Date() })
                .where(eq(teams.id, teamId))
              logger.info({ teamId, refCode: refRow.code }, 'referral code applied to new team')
            }
          }
        } else {
          teamId = teamMatch[0].id
        }

        _signupStep = 'upsertUser'
        userRow = await upsertUser({
          teamId,
          githubUserId: profile.id,
          githubLogin: profile.login,
          email,
          avatarUrl: profile.avatar_url ?? null,
          role: 'owner',
        })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const errCode = (err as { code?: string }).code
        logger.error({ err, errMsg, errCode, step: _signupStep, login: profile.login }, 'team auto-creation failed during oauth callback')
        // Encode a safe excerpt of the error (letters/numbers only) so it appears
        // in the browser URL for diagnosis — stripped of any user data or SQL values.
        const safeErr = encodeURIComponent(errMsg.replace(/[^a-zA-Z0-9_ ]/g, ' ').slice(0, 80))
        res.redirect(`${errorRedirect}&reason=team_create&step=${_signupStep}&emsg=${safeErr}`)
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

    logAuditEvent({
      teamId: userRow.teamId,
      userId: userRow.id,
      action: 'user.login',
      resourceType: 'user',
      resourceId: userRow.id,
      ipAddress: getIp(req),
      userAgent: req.headers['user-agent'] ?? null,
      metadata: { githubLogin: profile.login },
    })

    logger.info({ login: profile.login }, 'github oauth success')
    // Session cookie already set above — no token in URL (avoids browser history / log leakage).
    res.redirect(`${appUrl}/auth/callback?ok=1`)
  } catch (err) {
    logger.error({ err }, 'github oauth callback failed')
    res.redirect(`${errorRedirect}&reason=exception`)
  }
})

authRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  const rawToken = bearerToken ?? req.cookies?.[SESSION_COOKIE_NAME]

  // Revoke server-side so stolen cookies can't be replayed after logout.
  if (rawToken) {
    await deleteSession(rawToken)
  }

  clearSessionCookie(res)
  res.json({ ok: true })
})

authRouter.get('/auth/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const sess = req.session!
    // Select only the columns we actually return — avoids "column does not exist"
    // errors if a schema migration hasn't run yet on this DB instance.
    const userRow = await db
      .select({
        id: users.id,
        githubLogin: users.githubLogin,
        email: users.email,
        avatarUrl: users.avatarUrl,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, sess.userId))
      .limit(1)
    const teamRow = await db
      .select({
        id: teams.id,
        name: teams.name,
        slug: teams.slug,
        plan: teams.plan,
        trialEndsAt: teams.trialEndsAt,
        githubInstallationId: teams.githubInstallationId,
        monthlyAiSpendUsd: teams.monthlyAiSpendUsd,
        avgDevHourlyRateUsd: teams.avgDevHourlyRateUsd,
        timezone: teams.timezone,
        emailDigestEnabled: teams.emailDigestEnabled,
        emailDigestDay: teams.emailDigestDay,
        emailDigestHour: teams.emailDigestHour,
        slackWebhookUrl: teams.slackWebhookUrl,
        perSeatCostUsd: teams.perSeatCostUsd,
        toolSeatCosts: teams.toolSeatCosts,
        benchmarkingOptIn: teams.benchmarkingOptIn,
        teamSizeRange: teams.teamSizeRange,
        industry: teams.industry,
        demoMode: teams.demoMode,
      })
      .from(teams)
      .where(eq(teams.id, sess.teamId))
      .limit(1)
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
        emailDigestDay: t.emailDigestDay ?? 1,
        emailDigestHour: t.emailDigestHour ?? 9,
        slackWebhookUrl: t.slackWebhookUrl ?? null,
        perSeatCostUsd: t.perSeatCostUsd ?? 19,
        toolSeatCosts: (t.toolSeatCosts ?? {}) as Record<string, number>,
        benchmarkingOptIn: t.benchmarkingOptIn ?? false,
        teamSizeRange: t.teamSizeRange ?? null,
        industry: t.industry ?? null,
        demoMode: t.demoMode ?? false,
      },
    })
  } catch (err) {
    logger.error({ err }, 'auth/me db query failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

function generateState(ref?: string): string {
  const nonce = crypto.randomBytes(16).toString('hex')
  return ref ? `${nonce}:${ref}` : nonce
}

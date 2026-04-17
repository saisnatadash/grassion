import { eq } from 'drizzle-orm'
import { teams, users, repos, type NewTeam } from '@grassion/db'
import { db } from '../db.js'
import { logger } from '../logger.js'
import { addDays } from '@grassion/shared'

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `team-${Date.now()}`
}

export async function ensureUniqueSlug(base: string): Promise<string> {
  let candidate = base
  let i = 1
  while (true) {
    const existing = await db.select({ id: teams.id }).from(teams).where(eq(teams.slug, candidate)).limit(1)
    if (existing.length === 0) return candidate
    i++
    candidate = `${base}-${i}`
  }
}

export interface InstallationLite {
  id: number
  // GitHub may return either a User-like account (with `login`) or an
  // Enterprise-like account (with `slug`/`name`). We accept the union and
  // resolve to a usable display name below.
  account: { login?: string; slug?: string; name?: string | null; type?: string; id: number } | null
}

export async function createTeamFromInstallation(installation: InstallationLite) {
  const account = installation.account
  const accountLogin = account?.login ?? account?.slug ?? account?.name
  if (!account || !accountLogin) {
    logger.warn({ installationId: installation.id }, 'installation has no account, skipping team creation')
    return null
  }

  const existing = await db
    .select()
    .from(teams)
    .where(eq(teams.githubInstallationId, installation.id))
    .limit(1)
  if (existing[0]) {
    logger.info({ installationId: installation.id }, 'team already exists for installation')
    return existing[0]
  }

  const baseSlug = slugify(accountLogin)
  const slug = await ensureUniqueSlug(baseSlug)
  const trialEndsAt = addDays(new Date(), 14)

  const insert: NewTeam = {
    name: accountLogin,
    slug,
    githubInstallationId: installation.id,
    githubAccountLogin: accountLogin,
    githubAccountType: account.type ?? 'Organization',
    plan: 'trial',
    trialEndsAt,
  }
  const [team] = await db.insert(teams).values(insert).returning()
  logger.info({ teamId: team!.id, installationId: installation.id }, 'team created from installation')
  return team!
}

export async function deactivateTeam(installationId: number) {
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.githubInstallationId, installationId))
    .limit(1)
  if (!team) return
  await db
    .update(repos)
    .set({ isActive: false })
    .where(eq(repos.teamId, team.id))
  await db
    .update(teams)
    .set({ githubInstallationId: null, updatedAt: new Date() })
    .where(eq(teams.id, team.id))
  logger.info({ teamId: team.id }, 'team deactivated')
}

export async function upsertUser(params: {
  teamId: string
  githubUserId: number
  githubLogin: string
  email?: string | null
  avatarUrl?: string | null
  role?: 'owner' | 'admin' | 'member'
}) {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.githubUserId, params.githubUserId))
    .limit(1)
  if (existing[0]) {
    await db
      .update(users)
      .set({
        githubLogin: params.githubLogin,
        email: params.email ?? existing[0].email,
        avatarUrl: params.avatarUrl ?? existing[0].avatarUrl,
      })
      .where(eq(users.id, existing[0].id))
    return existing[0]
  }
  const [created] = await db
    .insert(users)
    .values({
      teamId: params.teamId,
      githubUserId: params.githubUserId,
      githubLogin: params.githubLogin,
      email: params.email ?? null,
      avatarUrl: params.avatarUrl ?? null,
      role: params.role ?? 'member',
    })
    .returning()
  return created!
}

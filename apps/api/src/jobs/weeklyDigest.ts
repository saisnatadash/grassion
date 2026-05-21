import { ne, eq, and, gte, isNotNull, desc } from 'drizzle-orm'
import {
  teams,
  users,
  pullRequests,
  prOutcomes,
  repos,
  teamWeeklyMetrics,
} from '@grassion/db'
import { db } from '../db.js'
import { logger } from '../logger.js'
import { env } from '../env.js'
import { startOfWeekUtc, addDays } from '@grassion/shared'
import { sendWeeklyDigestEmail, type DigestEmailData } from '../lib/email.js'

export async function runWeeklyDigest(): Promise<{ sent: number; failed: number }> {
  const now = new Date()
  const lastWeekStart = addDays(startOfWeekUtc(now), -7)

  const eligibleTeams = await db
    .select()
    .from(teams)
    .where(ne(teams.plan, 'trial'))

  let sent = 0
  let failed = 0

  for (const team of eligibleTeams) {
    try {
      await sendDigestForTeam(team.id, lastWeekStart, now)
      sent++
    } catch (err) {
      logger.error({ err, teamId: team.id }, 'admin trigger digest failed for team')
      failed++
    }
  }

  return { sent, failed }
}

async function sendDigestForTeam(teamId: string, lastWeekStart: Date, now: Date): Promise<void> {
  const team = (await db.select().from(teams).where(eq(teams.id, teamId)).limit(1))[0]
  if (!team) return

  // Send only to the owner, falling back to first admin
  const owner =
    (await db.select().from(users).where(and(eq(users.teamId, teamId), eq(users.role, 'owner'))).limit(1))[0] ??
    (await db.select().from(users).where(and(eq(users.teamId, teamId), eq(users.role, 'admin'))).limit(1))[0]

  if (!owner?.email) {
    logger.info({ teamId }, 'no owner/admin with email, skipping admin-triggered digest')
    return
  }

  const metric = (
    await db
      .select()
      .from(teamWeeklyMetrics)
      .where(and(eq(teamWeeklyMetrics.teamId, teamId), eq(teamWeeklyMetrics.weekStart, lastWeekStart)))
      .limit(1)
  )[0]

  if (!metric || (metric.totalPrs ?? 0) === 0) {
    logger.info({ teamId }, 'no metrics for last week, skipping admin-triggered digest')
    return
  }

  // Seat waste computation
  const allUsers = await db.select().from(users).where(eq(users.teamId, teamId))
  const totalSeats = allUsers.length
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000)

  const activeLoginSet = new Set<string>()
  if (totalSeats > 0) {
    const activePrs = await db
      .select({ authorLogin: pullRequests.authorLogin })
      .from(pullRequests)
      .where(
        and(eq(pullRequests.teamId, teamId), gte(pullRequests.mergedAt, fourWeeksAgo), isNotNull(pullRequests.mergedAt)),
      )
    for (const p of activePrs) if (p.authorLogin) activeLoginSet.add(p.authorLogin)
  }

  const activeSeats = activeLoginSet.size
  const inactiveUsers = allUsers.filter((u) => !activeLoginSet.has(u.githubLogin)).map((u) => u.githubLogin)
  const monthlyWaste =
    totalSeats > 0 ? (inactiveUsers.length / totalSeats) * (team.monthlyAiSpendUsd ?? 0) : 0

  // Problem PRs
  const problemPrsRaw = await db
    .select({ pr: pullRequests, outcome: prOutcomes, repo: repos })
    .from(pullRequests)
    .innerJoin(prOutcomes, eq(prOutcomes.prId, pullRequests.id))
    .innerJoin(repos, eq(repos.id, pullRequests.repoId))
    .where(
      and(eq(pullRequests.teamId, teamId), gte(pullRequests.mergedAt, lastWeekStart), isNotNull(pullRequests.mergedAt)),
    )
    .orderBy(desc(prOutcomes.reworkScore))
    .limit(5)

  const humanAvg = metric.humanAvgMergeHours ?? 0
  const aiAvg = metric.aiAvgMergeHours ?? 0
  const speedDeltaPercent = humanAvg > 0 ? Math.round(((humanAvg - aiAvg) / humanAvg) * 100) : 0
  const netDollar = (metric.estimatedDollarSaved ?? 0) - (metric.estimatedDollarLost ?? 0)

  const data: DigestEmailData = {
    teamName: team.name,
    weekStart: lastWeekStart,
    totalPrs: metric.totalPrs ?? 0,
    aiPrs: metric.aiPrs ?? 0,
    netDollar,
    verdict: (metric.verdict ?? 'insufficient_data') as DigestEmailData['verdict'],
    speedDeltaPercent,
    totalSeats,
    activeSeats,
    monthlyWaste,
    inactiveUsers,
    problemPrs: problemPrsRaw
      .filter((row) => (row.outcome.reworkScore ?? 0) >= 30)
      .map((row) => ({
        number: row.pr.githubPrNumber,
        title: row.pr.title,
        reason: row.outcome.aiSummary ?? reasonFor(row.outcome),
        url: `https://github.com/${row.repo.owner}/${row.repo.name}/pull/${row.pr.githubPrNumber}`,
      })),
    dashboardUrl: `${env().APP_URL}/dashboard`,
  }

  await sendWeeklyDigestEmail(owner.email, data)

  await db.update(teams).set({ lastDigestSentAt: new Date() }).where(eq(teams.id, teamId))
  logger.info({ teamId, to: owner.email }, 'admin-triggered weekly digest sent')
}

function reasonFor(o: {
  wasReverted: boolean | null
  revertPrNumber: number | null
  downstreamFixCount: number | null
  ciFailureCount: number | null
  hadHotfixWithin7d: boolean | null
}): string {
  const parts: string[] = []
  if (o.wasReverted) parts.push(`reverted in #${o.revertPrNumber ?? '?'}`)
  if ((o.downstreamFixCount ?? 0) > 0) parts.push(`${o.downstreamFixCount} downstream fix(es)`)
  if ((o.ciFailureCount ?? 0) > 0) parts.push(`${o.ciFailureCount} CI failure(s)`)
  if (o.hadHotfixWithin7d) parts.push('hotfix within 7d')
  return parts.join(', ') || 'high rework score'
}

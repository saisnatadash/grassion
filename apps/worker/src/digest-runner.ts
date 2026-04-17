import { eq, and, gte, isNotNull, desc } from 'drizzle-orm'
import {
  teams,
  users,
  pullRequests,
  prOutcomes,
  repos,
  emailDigests,
  teamWeeklyMetrics,
} from '@grassion/db'
import { db } from './db.js'
import { logger } from './logger.js'
import { env } from './env.js'
import { startOfWeekUtc, addDays } from '@grassion/shared'
import { weeklyDigestText, weeklyDigestSubject, weeklyDigestHtml } from './emails/weekly-digest.js'
import { sendEmail } from './emails/send.js'

/**
 * Sends weekly digest to every team where it is due (today is the team's
 * configured emailDigestDay AND we haven't already sent for this week).
 */
export async function sendDigestsForDueTeams(now: Date = new Date()) {
  const today = now.getUTCDay() // 0=Sun … 6=Sat
  const eligible = await db
    .select()
    .from(teams)
    .where(and(eq(teams.emailDigestEnabled, true), eq(teams.emailDigestDay, today)))

  for (const team of eligible) {
    try {
      await sendDigestForTeam(team.id, now)
    } catch (err) {
      logger.error({ err, teamId: team.id }, 'failed to send weekly digest')
      await db.insert(emailDigests).values({
        teamId: team.id,
        weekStart: startOfWeekUtc(now),
        recipientCount: 0,
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

export async function sendDigestForTeam(teamId: string, now: Date = new Date()) {
  // Digest reports the COMPLETED week (last week), not the current in-progress week.
  const lastWeekStart = addDays(startOfWeekUtc(now), -7)
  const team = (await db.select().from(teams).where(eq(teams.id, teamId)).limit(1))[0]
  if (!team) throw new Error('team not found')

  const already = await db
    .select({ id: emailDigests.id })
    .from(emailDigests)
    .where(
      and(
        eq(emailDigests.teamId, teamId),
        eq(emailDigests.weekStart, lastWeekStart),
        eq(emailDigests.status, 'sent'),
      ),
    )
    .limit(1)
  if (already.length > 0) {
    logger.info({ teamId }, 'digest already sent for this week, skipping')
    return
  }

  const metric = (
    await db
      .select()
      .from(teamWeeklyMetrics)
      .where(and(eq(teamWeeklyMetrics.teamId, teamId), eq(teamWeeklyMetrics.weekStart, lastWeekStart)))
      .limit(1)
  )[0]

  // Skip emailing if there's no real signal yet.
  if (!metric || (metric.totalPrs ?? 0) === 0) {
    logger.info({ teamId }, 'no metrics for last week, skipping digest')
    return
  }

  const memberRows = await db.select().from(users).where(eq(users.teamId, teamId))
  const recipients = memberRows.map((m) => m.email).filter((e): e is string => !!e)
  if (recipients.length === 0) {
    logger.info({ teamId }, 'no recipients with email, skipping digest')
    return
  }

  const aiAvg = metric.aiAvgMergeHours ?? 0
  const humanAvg = metric.humanAvgMergeHours ?? 0
  const speedDeltaPercent = humanAvg > 0 ? Math.round(((humanAvg - aiAvg) / humanAvg) * 100) : 0
  const aiRework = metric.aiReworkRate ?? 0
  const humanRework = metric.humanReworkRate ?? 0
  const reworkMultiplier =
    humanRework > 0 ? Number((aiRework / humanRework).toFixed(2)) : aiRework > 0 ? 99 : 1
  const netDollar = (metric.estimatedDollarSaved ?? 0) - (metric.estimatedDollarLost ?? 0)

  const problemPrs = await db
    .select({ pr: pullRequests, outcome: prOutcomes, repo: repos })
    .from(pullRequests)
    .innerJoin(prOutcomes, eq(prOutcomes.prId, pullRequests.id))
    .innerJoin(repos, eq(repos.id, pullRequests.repoId))
    .where(
      and(
        eq(pullRequests.teamId, teamId),
        gte(pullRequests.mergedAt, lastWeekStart),
        isNotNull(pullRequests.mergedAt),
      ),
    )
    .orderBy(desc(prOutcomes.reworkScore))
    .limit(5)

  const data = {
    teamName: team.name,
    weekStart: lastWeekStart,
    totalPrs: metric.totalPrs ?? 0,
    aiPrs: metric.aiPrs ?? 0,
    speedDeltaPercent,
    reworkMultiplier,
    netDollar,
    verdict: (metric.verdict ?? 'insufficient_data') as
      | 'net_positive'
      | 'net_negative'
      | 'unclear'
      | 'insufficient_data',
    problemPrs: problemPrs
      .filter((row) => (row.outcome.reworkScore ?? 0) >= 30)
      .map((row) => ({
        number: row.pr.githubPrNumber,
        title: row.pr.title,
        reason: row.outcome.aiSummary ?? reasonFor(row.outcome),
        url: `https://github.com/${row.repo.owner}/${row.repo.name}/pull/${row.pr.githubPrNumber}`,
      })),
    dashboardUrl: `${env().APP_URL}/dashboard`,
  }

  const text = weeklyDigestText(data)
  const html = weeklyDigestHtml(data)
  const subject = weeklyDigestSubject({ verdict: data.verdict })

  const sent = await sendEmail({ to: recipients, subject, text, html })
  await db.insert(emailDigests).values({
    teamId,
    weekStart: lastWeekStart,
    recipientCount: recipients.length,
    status: 'sent',
    errorMessage: null,
  })
  logger.info({ teamId, sentId: sent.id, recipients: recipients.length }, 'digest sent')
}

function reasonFor(o: typeof prOutcomes.$inferSelect): string {
  const parts: string[] = []
  if (o.wasReverted) parts.push(`reverted in #${o.revertPrNumber ?? '?'}`)
  if ((o.downstreamFixCount ?? 0) > 0) parts.push(`${o.downstreamFixCount} downstream fix(es)`)
  if ((o.ciFailureCount ?? 0) > 0) parts.push(`${o.ciFailureCount} CI failure(s)`)
  if (o.hadHotfixWithin7d) parts.push('hotfix within 7d')
  return parts.join(', ') || 'high rework score'
}

import { db } from '../db.js'
import {
  teams, teamWeeklyMetrics, codbaseHealthSnapshots, developerWeeklyMetrics,
  users, pullRequests,
} from '@grassion/db'
import { eq, and, desc, gte, isNotNull } from 'drizzle-orm'
import { startOfWeekUtc, addDays } from '@grassion/shared'
import { logger } from '../logger.js'

async function post(webhookUrl: string, payload: object): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Slack webhook ${res.status}: ${await res.text().catch(() => '')}`)
}

export async function sendSlackTest(webhookUrl: string): Promise<void> {
  await post(webhookUrl, {
    text: '✅ *Grassion test message* — your Slack integration is working!\n📊 Weekly digest and instant alerts are now active.',
  })
}

export async function sendRevertAlert(webhookUrl: string, prTitle: string, authorLogin: string | null, prUrl?: string): Promise<void> {
  const lines = [`⚠️ *PR reverted:* ${prTitle}${authorLogin ? ` by @${authorLogin}` : ''}`]
  if (prUrl) lines.push(`<${prUrl}|View PR>`)
  await post(webhookUrl, { text: lines.join('\n') })
}

export async function sendHealthDropAlert(webhookUrl: string, score: number): Promise<void> {
  await post(webhookUrl, {
    text: `🔴 *Health score dropped to ${score}/100*\nAI code quality has fallen below the warning threshold. Review recent PRs in <https://app.grassion.com/dashboard|Grassion>.`,
  })
}

export async function sendInactiveSeatAlert(webhookUrl: string, githubLogin: string, weeklyCostUsd: number): Promise<void> {
  await post(webhookUrl, {
    text: `💸 *@${githubLogin}* hasn't used AI in 7 days — wasted ~$${weeklyCostUsd.toFixed(0)} this week.\nReview seat usage at <https://app.grassion.com/spend|Spend Intelligence>.`,
  })
}

export async function sendWeeklyDigest(webhookUrl: string, teamId: string): Promise<void> {
  const now = new Date()
  const lastWeekStartDate = addDays(startOfWeekUtc(now), -7)
  const lastWeekStart = lastWeekStartDate.toISOString().slice(0, 10)

  const [metric] = await db
    .select()
    .from(teamWeeklyMetrics)
    .where(and(eq(teamWeeklyMetrics.teamId, teamId), eq(teamWeeklyMetrics.weekStart, lastWeekStartDate)))
    .limit(1)

  if (!metric || (metric.totalPrs ?? 0) === 0) return

  const totalPrs = metric.totalPrs ?? 0
  const aiPrs = metric.aiPrs ?? 0
  const adoptionPct = totalPrs > 0 ? Math.round((aiPrs / totalPrs) * 100) : 0
  const netDollar = (metric.estimatedDollarSaved ?? 0) - (metric.estimatedDollarLost ?? 0)
  const verdict = metric.verdict ?? 'insufficient_data'
  const verdictEmoji = verdict === 'net_positive' ? '✅' : verdict === 'net_negative' ? '⚠️' : '➖'
  const verdictText =
    verdict === 'net_positive' ? `Net positive +$${netDollar.toFixed(0)}` :
    verdict === 'net_negative' ? `Net negative -$${Math.abs(netDollar).toFixed(0)}` :
    'Unclear'

  // Revert count estimate from rework rate
  const revertCount = Math.round((metric.aiReworkRate ?? 0) * aiPrs)

  // Latest health snapshot
  const [healthRow] = await db
    .select({ score: codbaseHealthSnapshots.overallHealthScore })
    .from(codbaseHealthSnapshots)
    .where(eq(codbaseHealthSnapshots.teamId, teamId))
    .orderBy(desc(codbaseHealthSnapshots.snapshotDate))
    .limit(1)

  // Top performer this week (highest quality score with at least 1 AI PR)
  const [topDev] = await db
    .select({ githubLogin: developerWeeklyMetrics.githubLogin, qualityScore: developerWeeklyMetrics.qualityScore })
    .from(developerWeeklyMetrics)
    .where(and(eq(developerWeeklyMetrics.teamId, teamId), eq(developerWeeklyMetrics.weekStart, lastWeekStart)))
    .orderBy(desc(developerWeeklyMetrics.qualityScore))
    .limit(1)
    // developerWeeklyMetrics.weekStart is a date column (string), lastWeekStart is 'YYYY-MM-DD'

  const fields: Array<{ type: 'mrkdwn'; text: string }> = [
    { type: 'mrkdwn', text: `*ROI Verdict*\n${verdictText}` },
    { type: 'mrkdwn', text: `*AI Adoption*\n${adoptionPct}% of ${totalPrs} PRs` },
    { type: 'mrkdwn', text: `*Estimated Savings*\n$${Math.max(0, (metric.estimatedDollarSaved ?? 0)).toFixed(0)}` },
    { type: 'mrkdwn', text: `*Reverts*\n${revertCount} this week` },
  ]
  if (healthRow?.score != null) {
    fields.push({ type: 'mrkdwn', text: `*Health Score*\n${Math.round(healthRow.score)}/100` })
  }
  if (topDev) {
    fields.push({ type: 'mrkdwn', text: `*Top Performer*\n@${topDev.githubLogin}` })
  }

  await post(webhookUrl, {
    text: `${verdictEmoji} Grassion Weekly: ${verdictText} | AI Adoption: ${adoptionPct}% | <https://app.grassion.com/dashboard|View Dashboard>`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${verdictEmoji} Grassion Weekly ROI Digest`, emoji: true },
      },
      { type: 'section', fields },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View Dashboard →', emoji: true },
            url: 'https://app.grassion.com/dashboard',
          },
        ],
      },
    ],
  })
}

// In-memory throttle: teamId+type → last alert timestamp
const alertThrottle = new Map<string, number>()
function throttled(key: string, cooldownMs = 6 * 60 * 60 * 1000): boolean {
  const last = alertThrottle.get(key) ?? 0
  if (Date.now() - last < cooldownMs) return true
  alertThrottle.set(key, Date.now())
  return false
}

export async function runSlackAlertCheck(): Promise<void> {
  const allTeams = await db
    .select({ id: teams.id, slackWebhookUrl: teams.slackWebhookUrl, monthlyAiSpendUsd: teams.monthlyAiSpendUsd })
    .from(teams)
    .where(isNotNull(teams.slackWebhookUrl))

  for (const team of allTeams) {
    const webhookUrl = team.slackWebhookUrl!

    // ── Health score drop alert ──
    if (!throttled(`health:${team.id}`)) {
      try {
        const [snap] = await db
          .select({ score: codbaseHealthSnapshots.overallHealthScore })
          .from(codbaseHealthSnapshots)
          .where(eq(codbaseHealthSnapshots.teamId, team.id))
          .orderBy(desc(codbaseHealthSnapshots.snapshotDate))
          .limit(1)
        if (snap?.score != null && snap.score < 75) {
          await sendHealthDropAlert(webhookUrl, Math.round(snap.score))
        } else {
          // didn't fire — reset throttle so it fires next time it drops
          alertThrottle.delete(`health:${team.id}`)
        }
      } catch (err) {
        logger.error({ err, teamId: team.id }, 'slack health alert failed')
        alertThrottle.delete(`health:${team.id}`)
      }
    }

    // ── Inactive seat alert ──
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const allMembers = await db
      .select({ githubLogin: users.githubLogin })
      .from(users)
      .where(eq(users.teamId, team.id))

    for (const member of allMembers) {
      const throttleKey = `seat:${team.id}:${member.githubLogin}`
      if (throttled(throttleKey)) continue

      const [recentPr] = await db
        .select({ id: pullRequests.id })
        .from(pullRequests)
        .where(and(
          eq(pullRequests.teamId, team.id),
          eq(pullRequests.authorLogin, member.githubLogin),
          gte(pullRequests.mergedAt, sevenDaysAgo),
          isNotNull(pullRequests.aiSource),
        ))
        .limit(1)

      if (!recentPr) {
        const weeklyCost = ((team.monthlyAiSpendUsd ?? 0) / allMembers.length) / 4
        if (weeklyCost > 0) {
          try {
            await sendInactiveSeatAlert(webhookUrl, member.githubLogin, weeklyCost)
          } catch (err) {
            logger.error({ err, teamId: team.id }, 'slack inactive seat alert failed')
            alertThrottle.delete(throttleKey)
          }
        } else {
          alertThrottle.delete(throttleKey)
        }
      } else {
        alertThrottle.delete(throttleKey)
      }
    }
  }
}

export async function runWeeklySlackDigests(): Promise<void> {
  const allTeams = await db
    .select({ id: teams.id, slackWebhookUrl: teams.slackWebhookUrl })
    .from(teams)
    .where(isNotNull(teams.slackWebhookUrl))

  for (const team of allTeams) {
    try {
      await sendWeeklyDigest(team.slackWebhookUrl!, team.id)
      logger.info({ teamId: team.id }, 'slack weekly digest sent')
    } catch (err) {
      logger.error({ err, teamId: team.id }, 'slack weekly digest failed')
    }
  }
}

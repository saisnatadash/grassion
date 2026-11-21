/**
 * Weekly exceptions: finds PRs merged in the last 7 days that need attention —
 * merged without review, self-approved, or AI-heavy without attestation.
 * Sends one email per Pro team that has at least one exception.
 */
import { and, desc, gte, eq, isNotNull, inArray } from 'drizzle-orm'
import {
  teams, users, repos, pullRequests, hcAttestationLog,
} from '@grassion/db'
import { db } from './db.js'
import { logger } from './logger.js'
import { env } from './env.js'
import { sendEmail } from './emails/send.js'

// isProOrAbove is exported from @grassion/db but it's a function, let me re-define inline
function isProTeam(plan: string): boolean {
  return ['pro', 'team', 'growth', 'business', 'enterprise'].includes(plan)
}

interface ExceptionPr {
  prNumber: number
  title: string
  authorLogin: string | null
  mergedAt: string
  repoName: string
  reasons: string[]
  isAiHeavy: boolean
}

export async function sendWeeklyExceptionsForAllProTeams(): Promise<void> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const allTeams = await db
    .select({ id: teams.id, name: teams.name, plan: teams.plan, slackWebhookUrl: teams.slackWebhookUrl, notificationEmail: teams.notificationEmail })
    .from(teams)
    .where(isNotNull(teams.id))

  for (const team of allTeams) {
    if (!isProTeam(team.plan)) continue
    try {
      await processTeamExceptions(team, since)
    } catch (err) {
      logger.error({ err, teamId: team.id }, 'exceptions runner: team failed (non-fatal)')
    }
  }
}

async function processTeamExceptions(
  team: { id: string; name: string; plan: string; slackWebhookUrl: string | null; notificationEmail: string | null },
  since: Date,
): Promise<void> {
  const teamRepos = await db
    .select({ id: repos.id, name: repos.name, owner: repos.owner })
    .from(repos)
    .where(and(eq(repos.teamId, team.id), eq(repos.isActive, true)))

  if (teamRepos.length === 0) return

  const repoIds = teamRepos.map((r) => r.id)
  const repoNameById = new Map(teamRepos.map((r) => [r.id, `${r.owner}/${r.name}`]))

  // PRs merged in last 7 days
  const prs = await db
    .select({
      id: pullRequests.id,
      number: pullRequests.githubPrNumber,
      title: pullRequests.title,
      authorLogin: pullRequests.authorLogin,
      mergedAt: pullRequests.mergedAt,
      reviewCount: pullRequests.reviewCount,
      aiSource: pullRequests.aiSource,
      aiConfidence: pullRequests.aiConfidence,
      repoId: pullRequests.repoId,
    })
    .from(pullRequests)
    .where(and(
      eq(pullRequests.teamId, team.id),
      inArray(pullRequests.repoId, repoIds),
      isNotNull(pullRequests.mergedAt),
      gte(pullRequests.mergedAt, since),
    ))
    .orderBy(desc(pullRequests.mergedAt))
    .limit(200)

  if (prs.length === 0) return

  const prNumbers = prs.map((p) => p.number)

  // Attestations for these PRs
  const attestedPrNumbers = new Set<number>()
  if (prNumbers.length > 0) {
    const rows = await db
      .select({ prNumber: hcAttestationLog.prNumber })
      .from(hcAttestationLog)
      .where(and(eq(hcAttestationLog.orgId, team.id), inArray(hcAttestationLog.prNumber, prNumbers)))
    for (const r of rows) attestedPrNumbers.add(r.prNumber)
  }

  const exceptions: ExceptionPr[] = []

  for (const pr of prs) {
    if (!pr.mergedAt) continue
    const reasons: string[] = []
    const isAiHeavy = pr.aiSource != null && (pr.aiConfidence ?? 0) >= 0.5

    if ((pr.reviewCount ?? 0) === 0) {
      reasons.push('merged without any review')
    }
    if (isAiHeavy && !attestedPrNumbers.has(pr.number)) {
      reasons.push('AI-heavy PR with no attestation')
    }

    if (reasons.length > 0) {
      exceptions.push({
        prNumber: pr.number,
        title: pr.title,
        authorLogin: pr.authorLogin,
        mergedAt: pr.mergedAt.toISOString(),
        repoName: repoNameById.get(pr.repoId) ?? '',
        reasons,
        isAiHeavy,
      })
    }
  }

  if (exceptions.length === 0) return

  // notificationEmail (owner-configured) takes priority; fall back to owner/admin GitHub emails.
  let emails: string[]
  if (team.notificationEmail) {
    emails = [team.notificationEmail]
  } else {
    const recipients = await db
      .select({ email: users.email })
      .from(users)
      .where(and(
        eq(users.teamId, team.id),
        inArray(users.role, ['owner', 'admin']),
        isNotNull(users.email),
      ))
    emails = recipients.map((r) => r.email).filter((e): e is string => !!e)
  }

  if (emails.length === 0 && !team.slackWebhookUrl) return

  const subject = `[Grassion] ${exceptions.length} PR exception${exceptions.length !== 1 ? 's' : ''} this week — ${team.name}`
  const appUrl = env().APP_URL

  const text = [
    `${exceptions.length} pull request exception${exceptions.length !== 1 ? 's' : ''} in the last 7 days for ${team.name}:`,
    '',
    ...exceptions.map((e) =>
      `  #${e.prNumber} ${e.title}\n  Repo: ${e.repoName}\n  Author: ${e.authorLogin ?? '—'}\n  Issues: ${e.reasons.join(', ')}\n  ${appUrl}/receipts/${e.prNumber}`,
    ),
    '',
    `Review all receipts: ${appUrl}/receipts`,
    '',
    '— Grassion',
  ].join('\n')

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;background:#fff;color:#111;padding:24px;max-width:600px">
<h2 style="font-size:16px;font-weight:600;margin:0 0 4px">${exceptions.length} PR exception${exceptions.length !== 1 ? 's' : ''} this week</h2>
<p style="font-size:13px;color:#666;margin:0 0 20px">${team.name} · last 7 days</p>
<table style="width:100%;border-collapse:collapse;font-size:13px">
<thead>
<tr style="background:#f5f5f5">
<th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e5e5e5">PR</th>
<th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e5e5e5">Repo</th>
<th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e5e5e5">Issue</th>
</tr>
</thead>
<tbody>
${exceptions.map((e) => `
<tr>
<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top">
  <a href="${appUrl}/receipts/${e.prNumber}" style="color:#1a56db;text-decoration:none">#${e.prNumber}</a>
  <div style="color:#888;font-size:11px;margin-top:2px">${e.title.slice(0, 60)}</div>
</td>
<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;color:#666">${e.repoName}</td>
<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top">
  ${e.reasons.map((r) => `<span style="display:inline-block;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px;font-size:11px;margin:1px">${r}</span>`).join(' ')}
</td>
</tr>`).join('')}
</tbody>
</table>
<p style="margin:20px 0 0;font-size:13px">
<a href="${appUrl}/receipts" style="color:#1a56db">View all receipts →</a>
</p>
<p style="margin:16px 0 0;font-size:11px;color:#aaa">Grassion · You're receiving this because you're an owner or admin.</p>
</body>
</html>`

  if (emails.length > 0) {
    await sendEmail({ to: emails, subject, text, html })
      .catch((err) => logger.error({ err, teamId: team.id }, 'exceptions email failed'))
  }

  // Slack notification
  if (team.slackWebhookUrl) {
    const slackText = `*${exceptions.length} PR exception${exceptions.length !== 1 ? 's' : ''} this week* — ${team.name}\n` +
      exceptions.slice(0, 5).map((e) =>
        `• <${appUrl}/receipts/${e.prNumber}|#${e.prNumber} ${e.title.slice(0, 50)}> — ${e.reasons.join(', ')}`
      ).join('\n') +
      (exceptions.length > 5 ? `\n… and ${exceptions.length - 5} more` : '') +
      `\n<${appUrl}/receipts|View all receipts>`

    await fetch(team.slackWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: slackText }),
    }).catch((err) => logger.error({ err, teamId: team.id }, 'exceptions slack notification failed'))
  }

  logger.info({ teamId: team.id, exceptionCount: exceptions.length }, 'exceptions runner: sent notifications')
}

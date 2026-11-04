import { eq, and, inArray, gt } from 'drizzle-orm'
import { teams, users, repos, hcPeople, hcCodeAreas, hcEvidenceEvents, notifications } from '@grassion/db'
import { db } from './db.js'
import { logger } from './logger.js'
import { sendEmail } from './emails/send.js'

function isProPlan(plan: string): boolean {
  return ['pro', 'team', 'growth', 'business', 'enterprise'].includes(plan)
}

async function slackPost(webhookUrl: string, payload: object): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Slack webhook ${res.status}`)
}

type TeamRow = {
  id: string
  name: string
  plan: string
  slackWebhookUrl: string | null
  hcCheckRunEnabled: boolean
}

// Called by the daily cron — checks all Pro teams for newly dark areas.
export async function checkAllTeamsForCoverageLoss(): Promise<void> {
  const rows = await db
    .select({ id: teams.id, name: teams.name, plan: teams.plan, slackWebhookUrl: teams.slackWebhookUrl, hcCheckRunEnabled: teams.hcCheckRunEnabled })
    .from(teams)
    .where(eq(teams.hcCheckRunEnabled, true))

  for (const team of rows) {
    if (!isProPlan(team.plan)) continue
    try {
      await checkTeamForCoverageLoss(team)
    } catch (err) {
      logger.error({ err, teamId: team.id }, 'coverage-loss: check failed')
    }
  }
}

// Called immediately from the webhook when a GitHub org member is removed.
export async function checkTeamAfterMemberLeft(teamId: string, githubLogin: string): Promise<void> {
  const [team] = await db
    .select({ id: teams.id, name: teams.name, plan: teams.plan, slackWebhookUrl: teams.slackWebhookUrl, hcCheckRunEnabled: teams.hcCheckRunEnabled })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1)
  if (!team || !isProPlan(team.plan) || !team.hcCheckRunEnabled) return
  await checkTeamForCoverageLoss(team, githubLogin)
}

async function checkTeamForCoverageLoss(team: TeamRow, specificLeftLogin?: string): Promise<void> {
  const activePeople = await db
    .select({ id: hcPeople.id })
    .from(hcPeople)
    .where(and(eq(hcPeople.orgId, team.id), eq(hcPeople.isActive, true)))

  const activePeopleIds = activePeople.map((p) => p.id)

  const activeRepos = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.teamId, team.id), eq(repos.isActive, true)))
  if (activeRepos.length === 0) return

  const repoIds = activeRepos.map((r) => r.id)
  const areas = await db
    .select({ id: hcCodeAreas.id, path: hcCodeAreas.path, isCritical: hcCodeAreas.isCritical })
    .from(hcCodeAreas)
    .where(and(eq(hcCodeAreas.orgId, team.id), inArray(hcCodeAreas.repoId, repoIds)))
  if (areas.length === 0) return

  const areaIds = areas.map((a) => a.id)

  // Net coverage weight per area, counting only currently active people.
  const events =
    activePeopleIds.length > 0
      ? await db
          .select({ areaId: hcEvidenceEvents.areaId, weight: hcEvidenceEvents.weight })
          .from(hcEvidenceEvents)
          .where(and(
            eq(hcEvidenceEvents.orgId, team.id),
            inArray(hcEvidenceEvents.areaId, areaIds),
            inArray(hcEvidenceEvents.personId, activePeopleIds),
          ))
      : []

  const netWeights = new Map<string, number>()
  for (const ev of events) {
    netWeights.set(ev.areaId, (netWeights.get(ev.areaId) ?? 0) + ev.weight)
  }

  // Only alert for areas that previously had coverage (at least one evidence event exists for them,
  // regardless of who), so we don't spam for areas that were always dark.
  const areaIdsWithAnyHistory = new Set(
    (await db
      .select({ areaId: hcEvidenceEvents.areaId })
      .from(hcEvidenceEvents)
      .where(and(eq(hcEvidenceEvents.orgId, team.id), inArray(hcEvidenceEvents.areaId, areaIds))))
      .map((e) => e.areaId),
  )

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const newlyDarkAreas: Array<{ id: string; path: string; isCritical: boolean }> = []

  for (const area of areas) {
    const hasHistory = areaIdsWithAnyHistory.has(area.id)
    if (!hasHistory) continue // area was always dark — not a "loss"

    const netWeight = netWeights.get(area.id) ?? 0
    if (netWeight > 0) continue // still covered

    // 7-day dedup: skip if we already sent an alert for this area this week.
    const recent = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.teamId, team.id),
        eq(notifications.type, 'coverage_loss'),
        eq(notifications.sourceId, area.id),
        gt(notifications.createdAt, sevenDaysAgo),
      ))
      .limit(1)
    if (recent.length > 0) continue

    newlyDarkAreas.push(area)
  }

  if (newlyDarkAreas.length === 0) return

  logger.info({ teamId: team.id, count: newlyDarkAreas.length, specificLeftLogin }, 'coverage-loss: alerting')

  // Upsert notifications (delete stale row, insert fresh) for each newly dark area.
  for (const area of newlyDarkAreas) {
    await db.delete(notifications).where(and(
      eq(notifications.teamId, team.id),
      eq(notifications.type, 'coverage_loss'),
      eq(notifications.sourceId, area.id),
    ))
    await db.insert(notifications).values({
      teamId: team.id,
      type: 'coverage_loss',
      title: `Coverage lost: ${area.path}`,
      body: `No active team member has coverage for ${area.path}. This area may be at risk.`,
      sourceId: area.id,
    })
  }

  const criticalCount = newlyDarkAreas.filter((a) => a.isCritical).length
  const memberNote = specificLeftLogin ? ` after ${specificLeftLogin} left` : ''

  // Slack alert
  if (team.slackWebhookUrl) {
    const areaList = newlyDarkAreas
      .slice(0, 5)
      .map((a) => `• \`${a.path}\`${a.isCritical ? ' 🔴 critical' : ''}`)
      .join('\n')
    const overflow = newlyDarkAreas.length > 5 ? `\n…and ${newlyDarkAreas.length - 5} more` : ''
    await slackPost(team.slackWebhookUrl, {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🔴 *${newlyDarkAreas.length} area${newlyDarkAreas.length > 1 ? 's' : ''} lost all human coverage${memberNote}*${criticalCount > 0 ? ` · ${criticalCount} critical` : ''}\n\n${areaList}${overflow}`,
          },
        },
        {
          type: 'actions',
          elements: [{ type: 'button', text: { type: 'plain_text', text: 'View Coverage Report →', emoji: true }, url: 'https://app.grassion.com/dark-code' }],
        },
      ],
    }).catch((err: unknown) => logger.error({ err, teamId: team.id }, 'coverage-loss: slack failed'))
  }

  // Email to owners / admins
  const admins = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.teamId, team.id), inArray(users.role, ['owner', 'admin'])))

  const emails = admins.map((u) => u.email).filter((e): e is string => !!e)
  if (emails.length > 0) {
    const areaLines = newlyDarkAreas
      .slice(0, 10)
      .map((a) => `  • ${a.path}${a.isCritical ? ' (critical)' : ''}`)
    if (newlyDarkAreas.length > 10) areaLines.push(`  …and ${newlyDarkAreas.length - 10} more`)

    await sendEmail({
      to: emails,
      subject: `[Grassion] ${newlyDarkAreas.length} area${newlyDarkAreas.length > 1 ? 's' : ''} lost all human coverage${memberNote ? ` — ${specificLeftLogin} left` : ''}`,
      text: [
        `Grassion detected ${newlyDarkAreas.length} code area${newlyDarkAreas.length > 1 ? 's' : ''} in ${team.name} that now have no active human reviewer${memberNote}.`,
        '',
        'Areas at risk:',
        ...areaLines,
        '',
        criticalCount > 0 ? `⚠️  ${criticalCount} of these are marked critical.\n` : null,
        'Consider scheduling a knowledge-transfer session or pairing a team member with this code.',
        '',
        'View the full report: https://app.grassion.com/dark-code',
      ].filter((l): l is string => l !== null).join('\n'),
    }).catch((err: unknown) => logger.error({ err, teamId: team.id }, 'coverage-loss: email failed'))
  }
}

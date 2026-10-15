import { eq, and, isNotNull, lt, gt, isNull, desc } from 'drizzle-orm'
import { teams, users, teamWeeklyMetrics } from '@grassion/db'
import { db } from './db.js'
import { logger } from './logger.js'
import { sendEmail } from './emails/send.js'

const APP_URL = process.env.APP_URL ?? 'https://app.grassion.com'

export async function sendTrialReminderEmails() {
  const now = new Date()
  // Target teams whose trial ends in 1–3 days and haven't been reminded yet.
  const in1Day = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  const expiring = await db
    .select({
      id: teams.id,
      name: teams.name,
      trialEndsAt: teams.trialEndsAt,
    })
    .from(teams)
    .where(
      and(
        eq(teams.plan, 'trial'),
        isNotNull(teams.trialEndsAt),
        gt(teams.trialEndsAt, in1Day),
        lt(teams.trialEndsAt, in3Days),
        isNull(teams.trialReminderSentAt),
      ),
    )

  logger.info({ count: expiring.length }, 'trial reminder: teams to notify')

  for (const team of expiring) {
    try {
      await sendReminderForTeam(team.id, team.name, team.trialEndsAt!)
      await db
        .update(teams)
        .set({ trialReminderSentAt: now })
        .where(eq(teams.id, team.id))
    } catch (err) {
      logger.error({ err, teamId: team.id }, 'trial reminder send failed')
    }
  }
}

async function sendReminderForTeam(teamId: string, teamName: string, trialEndsAt: Date) {
  // Get owner emails
  const members = await db
    .select({ email: users.email, role: users.role })
    .from(users)
    .where(eq(users.teamId, teamId))

  const recipients = members
    .filter((m) => m.role === 'owner' || m.role === 'admin')
    .map((m) => m.email)
    .filter((e): e is string => !!e)

  if (recipients.length === 0) {
    logger.warn({ teamId }, 'trial reminder: no owner/admin emails found, skipping')
    return
  }

  // Get latest weekly ROI number
  const latestMetric = (
    await db
      .select({
        estimatedDollarSaved: teamWeeklyMetrics.estimatedDollarSaved,
        estimatedDollarLost: teamWeeklyMetrics.estimatedDollarLost,
        aiPrs: teamWeeklyMetrics.aiPrs,
        totalPrs: teamWeeklyMetrics.totalPrs,
        verdict: teamWeeklyMetrics.verdict,
      })
      .from(teamWeeklyMetrics)
      .where(eq(teamWeeklyMetrics.teamId, teamId))
      .orderBy(desc(teamWeeklyMetrics.weekStart))
      .limit(1)
  )[0]

  const daysLeft = Math.ceil((trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  const expiryDate = trialEndsAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  let roiLine = ''
  if (latestMetric) {
    const net = (latestMetric.estimatedDollarSaved ?? 0) - (latestMetric.estimatedDollarLost ?? 0)
    const sign = net >= 0 ? '+' : ''
    roiLine = `Last week your team shipped ${latestMetric.aiPrs ?? 0} AI-assisted PRs out of ${latestMetric.totalPrs ?? 0} total. Estimated net ROI: ${sign}$${Math.round(net)}.\n\n`
  }

  const subject = `Your Grassion trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`

  const text = `Hey ${teamName},

Your 14-day free trial expires on ${expiryDate} — ${daysLeft} day${daysLeft === 1 ? '' : 's'} from now.

${roiLine}To keep your dashboard, weekly ROI reports, and problem PR alerts running, upgrade before your trial ends.

Upgrade now: ${APP_URL}/billing

If you have questions or need help, reply to this email.

— The Grassion Team`

  await sendEmail({ to: recipients, subject, text })
  logger.info({ teamId, recipients: recipients.length, daysLeft }, 'trial reminder sent')
}

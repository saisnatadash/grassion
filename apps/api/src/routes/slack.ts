import crypto from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { eq, and, inArray } from 'drizzle-orm'
import { teams, hcPeople, hcCodeAreas, hcEvidenceEvents } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { sendSlackTest } from '../lib/slack.js'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { extractAreaPath } from '../jobs/backfillCoverage.js'

export const slackRouter = Router()

// ── Slash command: /grassion who <path|area> ─────────────────────────────────

function verifySlackSignature(rawBody: Buffer, timestamp: string, signature: string): boolean {
  const secret = env().SLACK_SIGNING_SECRET
  if (!secret) return false
  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return false
  const sigBase = `v0:${timestamp}:${rawBody.toString('utf8')}`
  const expected = `v0=${crypto.createHmac('sha256', secret).update(sigBase).digest('hex')}`
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

slackRouter.post('/api/slack/commands', async (req: Request, res: Response) => {
  const timestamp = req.header('x-slack-request-timestamp') ?? ''
  const signature = req.header('x-slack-signature') ?? ''
  const rawBody = req.body as Buffer

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    res.status(401).json({ error: 'invalid_signature' })
    return
  }

  // Slack sends slash commands as application/x-www-form-urlencoded
  const params = new URLSearchParams(rawBody.toString('utf8'))
  const command = params.get('command') ?? ''
  const text = (params.get('text') ?? '').trim()
  const teamDomain = params.get('team_domain') ?? ''

  if (command !== '/grassion') {
    res.json({ response_type: 'ephemeral', text: 'Unknown command.' })
    return
  }

  const args = text.split(/\s+/)
  const subcommand = args[0]?.toLowerCase()

  if (subcommand !== 'who' || !args[1]) {
    res.json({
      response_type: 'ephemeral',
      text: 'Usage: `/grassion who <path|service|area>`',
    })
    return
  }

  const query = args.slice(1).join(' ')
  const areaPath = extractAreaPath(query)

  try {
    // Find team by Slack domain or fall back to first team matching webhook
    const allTeams = await db.select({ id: teams.id, plan: teams.plan }).from(teams).limit(50)
    const proTeams = allTeams.filter((t) => t.plan === 'team' || t.plan === 'business')
    if (proTeams.length === 0) {
      res.json({ response_type: 'ephemeral', text: 'No Pro team found.' })
      return
    }

    // Look for the area across all Pro teams' repos
    const orgIds = proTeams.map((t) => t.id)
    const areas = await db
      .select()
      .from(hcCodeAreas)
      .where(and(inArray(hcCodeAreas.orgId, orgIds), inArray(hcCodeAreas.path, [areaPath, query])))
      .limit(5)

    if (areas.length === 0) {
      res.json({
        response_type: 'in_channel',
        text: `No coverage data found for \`${query}\`. Run a backfill in Grassion settings first.`,
      })
      return
    }

    const areaIds = areas.map((a) => a.id)
    const [events, people] = await Promise.all([
      db.select().from(hcEvidenceEvents).where(and(inArray(hcEvidenceEvents.orgId, orgIds), inArray(hcEvidenceEvents.areaId, areaIds))),
      db.select().from(hcPeople).where(and(inArray(hcPeople.orgId, orgIds), eq(hcPeople.isActive, true))),
    ])

    const peopleMap = new Map(people.map((p) => [p.id, p]))
    const netWeights = new Map<string, number>()
    for (const ev of events) {
      netWeights.set(ev.personId, (netWeights.get(ev.personId) ?? 0) + ev.weight)
    }

    const ranked = [...netWeights.entries()]
      .filter(([, w]) => w > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([personId, weight]) => {
        const person = peopleMap.get(personId)
        return person ? { login: person.githubLogin, weight } : null
      })
      .filter((p): p is { login: string; weight: number } => p !== null)

    if (ranked.length === 0) {
      res.json({ response_type: 'in_channel', text: `⚫ \`${query}\` is dark — no human coverage found.` })
      return
    }

    const fields = ranked.map((p) => ({
      type: 'mrkdwn',
      text: `*@${p.login}*\nCoverage weight: ${p.weight.toFixed(1)}`,
    }))

    res.json({
      response_type: 'in_channel',
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Who covers \`${query}\`?*` },
        },
        { type: 'section', fields },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `<https://app.grassion.com/dark-code|View full Dark Code Report>` }],
        },
      ],
    })
  } catch (err) {
    logger.error({ err, query }, 'slack /grassion who failed')
    res.json({ response_type: 'ephemeral', text: 'Something went wrong. Check Grassion logs.' })
  }
})

slackRouter.post('/api/slack/test', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  try {
    const [team] = await db
      .select({ slackWebhookUrl: teams.slackWebhookUrl })
      .from(teams)
      .where(eq(teams.id, sess.teamId))
      .limit(1)

    if (!team?.slackWebhookUrl) {
      res.status(400).json({ error: 'no_webhook_url', message: 'No Slack webhook URL configured for this team.' })
      return
    }

    await sendSlackTest(team.slackWebhookUrl)
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'slack test failed')
    res.status(500).json({ error: 'send_failed', message: 'Could not send to Slack. Check your webhook URL.' })
  }
})

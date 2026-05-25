import { Router, type Request, type Response } from 'express'
import { eq } from 'drizzle-orm'
import { teams } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { sendSlackTest } from '../lib/slack.js'
import { logger } from '../logger.js'

export const slackRouter = Router()

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

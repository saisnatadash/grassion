import type { Request, Response } from 'express'
import { eq } from 'drizzle-orm'
import { teams } from '@grassion/db'
import { db } from '../db.js'
import { logger } from '../logger.js'
import { verifyWebhookSignature, planFromStatus } from '../billing/razorpay.js'

interface RazorpayWebhookEvent {
  event: string
  payload: {
    subscription?: { entity?: RazorpaySubscription }
    payment?: { entity?: RazorpayPayment }
  }
}

interface RazorpaySubscription {
  id: string
  status: string
  customer_id?: string
  current_end?: number
  notes?: { team_id?: string } | string[] | null
}

interface RazorpayPayment {
  id: string
  status: string
  amount: number
  currency: string
  email?: string
  contact?: string
  error_code?: string
  error_description?: string
  notes?: { team_id?: string } | string[] | null
}

export async function handleRazorpayWebhook(req: Request, res: Response) {
  const signature = req.header('x-razorpay-signature')
  if (!signature) {
    res.status(400).json({ error: 'missing x-razorpay-signature' })
    return
  }
  const rawBody = req.body as Buffer
  if (!verifyWebhookSignature(rawBody, signature)) {
    logger.error('razorpay webhook signature verification failed')
    res.status(400).json({ error: 'invalid razorpay signature' })
    return
  }

  let event: RazorpayWebhookEvent
  try {
    event = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookEvent
  } catch (err) {
    logger.error({ err }, 'razorpay webhook body parse failure')
    res.status(400).json({ error: 'invalid_body' })
    return
  }

  try {
    await routeRazorpayEvent(event)
    res.json({ received: true })
  } catch (err) {
    logger.error({ err, type: event.event }, 'razorpay event handler error')
    res.status(500).json({ error: 'handler error' })
  }
}

async function routeRazorpayEvent(event: RazorpayWebhookEvent) {
  switch (event.event) {
    case 'subscription.activated':
    case 'subscription.charged':
    case 'subscription.updated':
    case 'subscription.resumed':
    case 'subscription.authenticated': {
      const sub = event.payload.subscription?.entity
      if (sub) await syncSubscription(sub)
      break
    }
    case 'subscription.cancelled':
    case 'subscription.completed':
    case 'subscription.expired':
    case 'subscription.halted':
    case 'subscription.paused': {
      const sub = event.payload.subscription?.entity
      if (sub) await syncSubscription(sub)
      break
    }
    case 'subscription.pending': {
      const sub = event.payload.subscription?.entity
      if (sub) await syncSubscription(sub)
      break
    }
    case 'payment.failed': {
      const payment = event.payload.payment?.entity
      logger.warn(
        { paymentId: payment?.id, errorCode: payment?.error_code, reason: payment?.error_description },
        'razorpay payment failed',
      )
      break
    }
    case 'payment.captured': {
      const payment = event.payload.payment?.entity
      logger.info({ paymentId: payment?.id, amount: payment?.amount }, 'razorpay payment captured')
      break
    }
    default:
      logger.debug({ type: event.event }, 'unhandled razorpay event type')
  }
}

async function syncSubscription(sub: RazorpaySubscription) {
  const teamId = readTeamIdFromNotes(sub.notes)
  if (!teamId) {
    // Fall back to looking up by stored razorpay_subscription_id.
    const row = (
      await db.select().from(teams).where(eq(teams.razorpaySubscriptionId, sub.id)).limit(1)
    )[0]
    if (!row) {
      logger.warn({ subscriptionId: sub.id }, 'no team for razorpay subscription event')
      return
    }
    await applySubscriptionUpdate(row.id, sub)
    return
  }
  await applySubscriptionUpdate(teamId, sub)
}

async function applySubscriptionUpdate(teamId: string, sub: RazorpaySubscription) {
  const update: Record<string, unknown> = {
    razorpaySubscriptionId: sub.id,
    subscriptionStatus: sub.status,
    plan: planFromStatus(sub.status),
    updatedAt: new Date(),
  }
  if (sub.customer_id) update.razorpayCustomerId = sub.customer_id
  if (typeof sub.current_end === 'number') update.currentPeriodEnd = new Date(sub.current_end * 1000)
  await db.update(teams).set(update).where(eq(teams.id, teamId))
}

function readTeamIdFromNotes(notes: RazorpaySubscription['notes']): string | undefined {
  if (!notes) return undefined
  if (Array.isArray(notes)) return undefined
  return notes.team_id
}

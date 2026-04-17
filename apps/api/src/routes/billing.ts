import { Router, type Request, type Response } from 'express'
import { eq } from 'drizzle-orm'
import { teams, users } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import {
  cancelSubscription,
  createSubscription,
  fetchSubscription,
  planFromStatus,
  verifyCheckoutSignature,
} from '../billing/razorpay.js'
import { env } from '../env.js'
import { checkoutSchema, verifyPaymentSchema } from '@grassion/shared'

export const billingRouter = Router()

billingRouter.post(
  '/api/billing/subscribe',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    const parsed = checkoutSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input' })
      return
    }
    const team = (await db.select().from(teams).where(eq(teams.id, sess.teamId)).limit(1))[0]
    if (!team) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    const user = (await db.select().from(users).where(eq(users.id, sess.userId)).limit(1))[0]
    const e = env()
    const sub = await createSubscription({
      planId: e.RAZORPAY_PLAN_ID_STARTER,
      customerEmail: user?.email ?? '',
      customerName: user?.githubLogin ?? team.name,
      teamId: team.id,
      quantity: parsed.data.seatCount,
    })
    await db
      .update(teams)
      .set({
        razorpaySubscriptionId: sub.id,
        subscriptionStatus: sub.status,
        plan: planFromStatus(sub.status),
        updatedAt: new Date(),
      })
      .where(eq(teams.id, team.id))
    res.json({
      subscriptionId: sub.id,
      razorpayKey: e.RAZORPAY_KEY_ID,
      planId: e.RAZORPAY_PLAN_ID_STARTER,
      seatCount: parsed.data.seatCount,
    })
  },
)

billingRouter.post(
  '/api/billing/verify',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    const parsed = verifyPaymentSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input' })
      return
    }
    const ok = verifyCheckoutSignature({
      razorpayPaymentId: parsed.data.razorpay_payment_id,
      razorpaySubscriptionId: parsed.data.razorpay_subscription_id,
      razorpaySignature: parsed.data.razorpay_signature,
    })
    if (!ok) {
      res.status(400).json({ error: 'invalid_signature' })
      return
    }
    // Refresh subscription state from Razorpay; webhook may not have arrived yet.
    const sub = await fetchSubscription(parsed.data.razorpay_subscription_id)
    await db
      .update(teams)
      .set({
        razorpaySubscriptionId: sub.id,
        subscriptionStatus: sub.status,
        plan: planFromStatus(sub.status),
        updatedAt: new Date(),
      })
      .where(eq(teams.id, sess.teamId))
    res.json({ ok: true, status: sub.status })
  },
)

billingRouter.post(
  '/api/billing/cancel',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    const team = (await db.select().from(teams).where(eq(teams.id, sess.teamId)).limit(1))[0]
    if (!team?.razorpaySubscriptionId) {
      res.status(400).json({ error: 'no_subscription' })
      return
    }
    const sub = await cancelSubscription(team.razorpaySubscriptionId, true)
    await db
      .update(teams)
      .set({
        subscriptionStatus: sub.status,
        plan: planFromStatus(sub.status),
        updatedAt: new Date(),
      })
      .where(eq(teams.id, team.id))
    res.json({ ok: true, status: sub.status })
  },
)

billingRouter.get('/api/billing/subscription', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const team = (await db.select().from(teams).where(eq(teams.id, sess.teamId)).limit(1))[0]
  if (!team) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  if (!team.razorpaySubscriptionId) {
    res.json({
      plan: team.plan,
      status: 'none',
      trialEndsAt: team.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: team.currentPeriodEnd?.toISOString() ?? null,
      seatCount: 0,
    })
    return
  }
  let live: Awaited<ReturnType<typeof fetchSubscription>> | null = null
  try {
    live = await fetchSubscription(team.razorpaySubscriptionId)
  } catch {
    // Stale subscription id — fall back to last-known DB state.
  }
  res.json({
    plan: team.plan,
    status: live?.status ?? team.subscriptionStatus ?? 'none',
    trialEndsAt: team.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd:
      live?.current_end != null
        ? new Date(live.current_end * 1000).toISOString()
        : team.currentPeriodEnd?.toISOString() ?? null,
    seatCount: live?.quantity ?? 0,
  })
})

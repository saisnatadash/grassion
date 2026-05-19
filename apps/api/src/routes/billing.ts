import { Router, type Request, type Response } from 'express'
import { eq } from 'drizzle-orm'
import { teams, users } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import {
  cancelSubscription,
  createOrder,
  createSubscription,
  fetchSubscription,
  planFromStatus,
  verifyCheckoutSignature,
  verifyOrderSignature,
} from '../billing/razorpay.js'
import { env } from '../env.js'
import { checkoutSchema, verifyPaymentSchema, verifyOrderPaymentSchema } from '@grassion/shared'

export const billingRouter = Router()

/**
 * POST /api/billing/checkout
 * Creates a Razorpay Order for a one-time payment (₹2400 per seat).
 * The frontend opens the Razorpay modal with the returned order_id and key_id.
 */
billingRouter.post(
  '/api/billing/checkout',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    const parsed = checkoutSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input' })
      return
    }
    const e = env()
    const seatCount = parsed.data.seatCount
    // ₹2400 per seat per month, amount in paise (1 INR = 100 paise)
    const amount = seatCount * 2400 * 100
    const order = await createOrder({
      amount,
      currency: 'INR',
      receipt: `team_${sess.teamId.slice(0, 12)}`,
    })
    res.json({
      orderId: order.id,
      keyId: e.RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency,
      seatCount,
    })
  },
)

/**
 * POST /api/billing/verify
 * Verifies a completed Razorpay order payment, then upgrades the team's plan to 'starter'.
 */
billingRouter.post(
  '/api/billing/verify',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!

    // Detect order-based vs subscription-based payload
    if (req.body?.razorpay_order_id) {
      const parsed = verifyOrderPaymentSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_input' })
        return
      }
      const ok = verifyOrderSignature({
        razorpayPaymentId: parsed.data.razorpay_payment_id,
        razorpayOrderId: parsed.data.razorpay_order_id,
        razorpaySignature: parsed.data.razorpay_signature,
      })
      if (!ok) {
        res.status(400).json({ error: 'invalid_signature' })
        return
      }
      await db
        .update(teams)
        .set({
          plan: 'starter',
          subscriptionStatus: 'active',
          updatedAt: new Date(),
        })
        .where(eq(teams.id, sess.teamId))
      res.json({ ok: true, status: 'active', plan: 'starter' })
      return
    }

    // Legacy subscription-based verification
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
    if (!e.RAZORPAY_PLAN_ID_STARTER) {
      res.status(501).json({ error: 'subscription_not_configured', hint: 'Use /api/billing/checkout for order-based payments' })
      return
    }
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
      planId: e.RAZORPAY_PLAN_ID_STARTER ?? '',
      seatCount: parsed.data.seatCount,
    })
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

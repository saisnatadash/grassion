import Razorpay from 'razorpay'
import crypto from 'node:crypto'
import { env } from '../env.js'

let _razorpay: Razorpay | undefined

export function razorpay(): Razorpay {
  if (!_razorpay) {
    const e = env()
    if (!e.RAZORPAY_KEY_ID || !e.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay not configured: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET')
    }
    _razorpay = new Razorpay({ key_id: e.RAZORPAY_KEY_ID, key_secret: e.RAZORPAY_KEY_SECRET })
  }
  return _razorpay
}

export interface CreateSubscriptionParams {
  planId: string
  customerEmail: string
  customerName: string
  teamId: string
  quantity: number
}

export async function createSubscription(params: CreateSubscriptionParams) {
  return razorpay().subscriptions.create({
    plan_id: params.planId,
    // Razorpay requires total_count; 120 monthly cycles ≈ 10 years (renewable cap, not commitment).
    total_count: 120,
    quantity: params.quantity,
    customer_notify: 1,
    notes: {
      team_id: params.teamId,
      customer_email: params.customerEmail,
      customer_name: params.customerName,
    },
  })
}

export async function fetchSubscription(subscriptionId: string) {
  return razorpay().subscriptions.fetch(subscriptionId)
}

export async function cancelSubscription(subscriptionId: string, cancelAtCycleEnd = true) {
  return razorpay().subscriptions.cancel(subscriptionId, cancelAtCycleEnd)
}

/**
 * Creates a Razorpay Order for a one-time payment.
 * amount is in the smallest currency unit (paise for INR: ₹2400 = 240000 paise).
 */
export async function createOrder(params: {
  amount: number
  currency: string
  receipt: string
}) {
  return razorpay().orders.create({
    amount: params.amount,
    currency: params.currency,
    receipt: params.receipt,
  })
}

/**
 * Verifies the payment signature returned by Razorpay Checkout (order flow).
 * Razorpay docs: HMAC-SHA256(order_id + '|' + payment_id, RAZORPAY_KEY_SECRET).
 */
export function verifyOrderSignature(params: {
  razorpayPaymentId: string
  razorpayOrderId: string
  razorpaySignature: string
}): boolean {
  const secret = env().RAZORPAY_KEY_SECRET
  if (!secret) return false
  const payload = `${params.razorpayOrderId}|${params.razorpayPaymentId}`
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(params.razorpaySignature, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * Verifies the X-Razorpay-Signature header on an inbound webhook.
 * Compares HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET) to the header in constant time.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
  if (!signature) return false
  const secret = env().RAZORPAY_WEBHOOK_SECRET
  if (!secret) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * Verifies the payment signature returned by Razorpay Checkout (subscription flow).
 * Razorpay docs: HMAC-SHA256(payment_id + '|' + subscription_id, RAZORPAY_KEY_SECRET).
 */
export function verifyCheckoutSignature(params: {
  razorpayPaymentId: string
  razorpaySubscriptionId: string
  razorpaySignature: string
}): boolean {
  const secret = env().RAZORPAY_KEY_SECRET
  if (!secret) return false
  const payload = `${params.razorpayPaymentId}|${params.razorpaySubscriptionId}`
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(params.razorpaySignature, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

const STATUS_TO_PLAN: Record<string, string> = {
  active: 'starter',
  authenticated: 'trial',
  pending: 'trial',
  created: 'trial',
  halted: 'trial',
  cancelled: 'trial',
  completed: 'trial',
  expired: 'trial',
  paused: 'trial',
}

export function planFromStatus(status: string | undefined | null): string {
  if (!status) return 'trial'
  return STATUS_TO_PLAN[status] ?? 'trial'
}

import { z } from 'zod'

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(64).optional(),
  monthlyAiSpendUsd: z.number().min(0).max(1_000_000).optional(),
  avgDevHourlyRateUsd: z.number().min(0).max(10_000).optional(),
  emailDigestEnabled: z.boolean().optional(),
  emailDigestDay: z.number().int().min(0).max(6).optional(),
  emailDigestHour: z.number().int().min(0).max(23).optional(),
  slackWebhookUrl: z.string().url().nullable().optional(),
})

export const checkoutSchema = z.object({
  plan: z.enum(['starter', 'team', 'business']),
  seatCount: z.number().int().min(1).max(500),
})

export const verifyPaymentSchema = z.object({
  razorpay_payment_id: z.string().min(1),
  razorpay_subscription_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
})

// Order-based (one-time) payment verification — uses razorpay_order_id instead of subscription_id
export const verifyOrderPaymentSchema = z.object({
  razorpay_payment_id: z.string().min(1),
  razorpay_order_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
  seatCount: z.number().int().min(1).max(500).optional().default(1),
  plan: z.enum(['starter', 'team', 'business']).optional().default('starter'),
})

export const updateTeamSettingsSchema = z.object({
  perSeatCostUsd: z.number().min(0).max(1000),
  toolSeatCosts: z.record(z.string(), z.number().min(0).max(1000)),
})

export type UpdateTeamSettingsInput = z.infer<typeof updateTeamSettingsSchema>

export const repoToggleSchema = z.object({
  isActive: z.boolean(),
})

export const contactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(254),
  topic: z.enum(['sales', 'support', 'collaborate', 'bug', 'other']).optional().default('other'),
  message: z.string().min(1).max(5000),
  // Honeypot — must be empty. Submissions from bots usually fill every field.
  website: z.string().max(0).optional(),
})

export type UpdateTeamInput = z.infer<typeof updateTeamSchema>
export type CheckoutInput = z.infer<typeof checkoutSchema>
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>
export type VerifyOrderPaymentInput = z.infer<typeof verifyOrderPaymentSchema>
export type RepoToggleInput = z.infer<typeof repoToggleSchema>
export type ContactInput = z.infer<typeof contactSchema>

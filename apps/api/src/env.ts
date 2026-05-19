import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),

  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  GITHUB_APP_CLIENT_ID: z.string().min(1),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1),
  GITHUB_APP_WEBHOOK_SECRET: z.string().min(1),
  GITHUB_APP_SLUG: z.string().min(1).default('grassion'),

  JWT_SECRET: z.string().min(32),
  SESSION_COOKIE_DOMAIN: z.string().default(''),

  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
  RAZORPAY_PLAN_ID_STARTER: z.string().min(1).optional(),

  ZOHO_SMTP_HOST: z.string().min(1).default('smtp.zoho.in'),
  ZOHO_SMTP_PORT: z.coerce.number().int().default(587),
  ZOHO_SMTP_USER: z.string().min(1),
  ZOHO_SMTP_PASS: z.string().min(1),
  ZOHO_FROM_ADDRESS: z.string().min(1),
  ZOHO_TO_ADDRESS: z.string().min(1).default('contact@grassion.com'),

  APP_URL: z.string().url(),
  API_URL: z.string().url(),
  MARKETING_URL: z.string().url().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
      console.error('Invalid env vars:', parsed.error.flatten().fieldErrors)
      throw new Error('Invalid environment configuration')
    }
    cached = parsed.data
  }
  return cached
}

export function normalizePrivateKey(raw: string): string {
  // Allow private key supplied as a single line with literal "\n" sequences.
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
}

import { z } from 'zod'

const schema = z.object({
  /** 'development' | 'production' | 'test' */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** TCP port the Express server listens on (default: 3001) */
  PORT: z.coerce.number().int().default(3001),
  /** Pino log level (trace / debug / info / warn / error) */
  LOG_LEVEL: z.string().default('info'),

  /** Neon Postgres connection string */
  DATABASE_URL: z.string().min(1),

  /** GitHub App numeric ID (from app settings) */
  GITHUB_APP_ID: z.string().min(1),
  /** GitHub App RSA private key — may use literal \n for newlines */
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  /** GitHub OAuth App client ID */
  GITHUB_APP_CLIENT_ID: z.string().min(1),
  /** GitHub OAuth App client secret */
  GITHUB_APP_CLIENT_SECRET: z.string().min(1),
  /** HMAC secret used to verify incoming GitHub webhook deliveries */
  GITHUB_APP_WEBHOOK_SECRET: z.string().min(1),
  /** GitHub App slug (the app's URL-safe name) */
  GITHUB_APP_SLUG: z.string().min(1).default('grassion'),

  /** Secret used to sign JWT session tokens — must be 32+ chars */
  JWT_SECRET: z.string().min(32),
  /** Domain for the session cookie (e.g. '.grassion.com'); empty = current domain */
  SESSION_COOKIE_DOMAIN: z.string().default(''),

  /** Razorpay publishable key ID */
  RAZORPAY_KEY_ID: z.string().min(1),
  /** Razorpay secret key */
  RAZORPAY_KEY_SECRET: z.string().min(1),
  /** HMAC secret used to verify incoming Razorpay webhook deliveries */
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
  /** Razorpay plan ID for the Starter subscription (optional — order-based payments work without it) */
  RAZORPAY_PLAN_ID_STARTER: z.string().min(1).optional(),

  /** Zoho SMTP host (default: smtp.zoho.in) */
  ZOHO_SMTP_HOST: z.string().min(1).default('smtp.zoho.in'),
  /** Zoho SMTP port — 587 (STARTTLS) or 465 (SSL) */
  ZOHO_SMTP_PORT: z.coerce.number().int().default(587),
  /** Zoho SMTP username (the from address) */
  ZOHO_SMTP_USER: z.string().min(1),
  /** Zoho SMTP password or app-specific password */
  ZOHO_SMTP_PASS: z.string().min(1),
  /** From address for outbound emails */
  ZOHO_FROM_ADDRESS: z.string().min(1),
  /** Destination address for contact-form submissions */
  ZOHO_TO_ADDRESS: z.string().min(1).default('contact@grassion.com'),

  /** Public URL of the Grassion web app */
  APP_URL: z.string().url(),
  /** Public URL of this API — used in OAuth callbacks and email links */
  API_URL: z.string().url(),
  /** Public URL of the marketing site (optional) */
  MARKETING_URL: z.string().url().optional(),

  /** Resend API key for transactional email (optional — falls back to Zoho SMTP) */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** OpenAI API key (optional — required only if the worker is also deployed via this container) */
  OPENAI_API_KEY: z.string().min(1).optional(),

  /** Bearer token that protects /api/admin/* endpoints (optional — disabled if unset) */
  ADMIN_SECRET: z.string().min(1).optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
      process.stderr.write(
        `[api] Invalid env vars: ${JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)}\n`,
      )
      process.exit(1)
    }
    cached = parsed.data
  }
  return cached
}

export function normalizePrivateKey(raw: string): string {
  // Allow private key supplied as a single line with literal "\n" sequences.
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
}

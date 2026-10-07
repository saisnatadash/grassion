import { z } from 'zod'

const schema = z.object({
  /** 'development' | 'production' | 'test' */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Pino log level (trace / debug / info / warn / error) */
  LOG_LEVEL: z.string().default('info'),
  /** Neon Postgres connection string */
  DATABASE_URL: z.string().min(1),

  /** GitHub App numeric ID (from app settings) */
  GITHUB_APP_ID: z.string().min(1).optional(),
  /** GitHub App RSA private key — may use literal \n for newlines */
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),

  /** Resend API key for transactional email (weekly digest) */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** From address for outbound digest emails */
  EMAIL_FROM: z.string().min(1).optional(),

  /** OpenAI API key — used only for PR summaries in the worker */
  OPENAI_API_KEY: z.string().min(1).optional(),
  /** OpenAI model to use for PR summaries (default: gpt-4o-mini) */
  OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  /** Monthly OpenAI spend cap in USD — worker will skip summaries once exceeded */
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(10),

  /** Public URL of the Grassion web app — used in digest email links */
  APP_URL: z.string().url(),

  /** Cron expression for outcome tracker (default: every 6 hours) */
  OUTCOME_CRON: z.string().default('0 */6 * * *'),
  /** Cron expression for weekly digest runner (default: Monday 9am UTC) */
  WEEKLY_DIGEST_CRON: z.string().default('0 9 * * 1'),

  /** Port for the worker health-check HTTP server (default: 8081) */
  WORKER_HEALTH_PORT: z.coerce.number().int().default(8081),
  /** Email address to notify when the circuit breaker trips (optional) */
  ADMIN_ALERT_EMAIL: z.string().email().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
      process.stderr.write(
        `[worker] Invalid env vars: ${JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)}\n`,
      )
      process.exit(1)
    }
    cached = parsed.data
  }
  return cached
}

export function normalizePrivateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
}

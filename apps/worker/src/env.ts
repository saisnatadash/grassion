import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),

  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),

  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(10),

  APP_URL: z.string().url(),

  OUTCOME_CRON: z.string().default('0 */6 * * *'), // every 6 hours
  WEEKLY_DIGEST_CRON: z.string().default('0 9 * * 1'), // Monday 9am UTC
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
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
}

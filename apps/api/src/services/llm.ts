import { and, eq, gte, sql } from 'drizzle-orm'
import OpenAI from 'openai'
import { llmUsageLog } from '@grassion/db'
import { db } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { increment } from '../lib/monitoring.js'

// gpt-4o-mini blended cost: $0.15/1M input + $0.60/1M output ≈ $0.375/1M
const COST_PER_TOKEN_USD = 0.375 / 1_000_000
const PER_TEAM_DAILY_CAP_USD = 2.0

export class LlmCapExceededError extends Error {
  constructor(
    public readonly scope: 'team_daily' | 'global_daily' | 'global_monthly',
    message: string,
  ) {
    super(message)
    this.name = 'LlmCapExceededError'
  }
}

export interface LlmCallParams {
  teamId?: string | null
  messages: OpenAI.ChatCompletionMessageParam[]
  model?: string
  maxTokens?: number
  temperature?: number
  purpose?: string
}

let _openai: OpenAI | undefined

function getOpenAI(): OpenAI | null {
  const key = env().OPENAI_API_KEY
  if (!key) return null
  if (!_openai) _openai = new OpenAI({ apiKey: key })
  return _openai
}

export async function callOpenAI(params: LlmCallParams): Promise<string | null> {
  const openai = getOpenAI()
  if (!openai) return null

  const model = params.model ?? 'gpt-4o-mini'
  const purpose = params.purpose ?? 'pr_summary'
  const e = env()

  const now = new Date()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  // Check per-team daily cap ($2/day)
  if (params.teamId) {
    const [row] = await db
      .select({ spent: sql<string>`coalesce(sum(estimated_cost_usd), 0)` })
      .from(llmUsageLog)
      .where(and(eq(llmUsageLog.teamId, params.teamId), gte(llmUsageLog.createdAt, dayStart)))
    if (parseFloat(row?.spent ?? '0') >= PER_TEAM_DAILY_CAP_USD) {
      logger.warn({ teamId: params.teamId }, 'llm: team daily cap exceeded')
      increment('llm_cap_hit')
      throw new LlmCapExceededError(
        'team_daily',
        `Daily AI summary budget reached ($${PER_TEAM_DAILY_CAP_USD}/day). Try again tomorrow.`,
      )
    }
  }

  // Check global daily cap (env OPENAI_DAILY_CAP_USD, default $20)
  const globalDailyCap = e.OPENAI_DAILY_CAP_USD ?? 20
  const [dayRow] = await db
    .select({ spent: sql<string>`coalesce(sum(estimated_cost_usd), 0)` })
    .from(llmUsageLog)
    .where(gte(llmUsageLog.createdAt, dayStart))
  if (parseFloat(dayRow?.spent ?? '0') >= globalDailyCap) {
    logger.warn({ globalDailyCap }, 'llm: global daily cap exceeded')
    increment('llm_cap_hit')
    throw new LlmCapExceededError(
      'global_daily',
      'Global daily AI budget reached. Summaries will resume tomorrow.',
    )
  }

  // Check global monthly cap (env OPENAI_MONTHLY_CAP_USD, default $50)
  const globalMonthlyCap = e.OPENAI_MONTHLY_CAP_USD ?? 50
  const [monthRow] = await db
    .select({ spent: sql<string>`coalesce(sum(estimated_cost_usd), 0)` })
    .from(llmUsageLog)
    .where(gte(llmUsageLog.createdAt, monthStart))
  if (parseFloat(monthRow?.spent ?? '0') >= globalMonthlyCap) {
    logger.warn({ globalMonthlyCap }, 'llm: global monthly cap exceeded')
    increment('llm_cap_hit')
    throw new LlmCapExceededError(
      'global_monthly',
      'Monthly AI budget reached. Summaries will resume next month.',
    )
  }

  const res = await openai.chat.completions.create({
    model,
    max_tokens: params.maxTokens ?? 80,
    temperature: params.temperature ?? 0.3,
    messages: params.messages,
  })

  const content = res.choices[0]?.message.content?.trim() ?? null
  const inputTokens = res.usage?.prompt_tokens ?? 0
  const outputTokens = res.usage?.completion_tokens ?? 0
  const totalTokens = res.usage?.total_tokens ?? inputTokens + outputTokens
  const estimatedCostUsd = totalTokens * COST_PER_TOKEN_USD

  await db
    .insert(llmUsageLog)
    .values({ teamId: params.teamId ?? null, tokens: totalTokens, inputTokens, outputTokens, estimatedCostUsd, purpose, model })
    .catch((err) => logger.warn({ err }, 'llm: failed to record usage'))

  return content
}

// Pure helper — usable in unit tests without DB mocking.
export function checkBudgetExceeded(spent: number, cap: number): boolean {
  return spent >= cap
}

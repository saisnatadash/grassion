import OpenAI from 'openai'
import { gte } from 'drizzle-orm'
import { llmUsageLog } from '@grassion/db'
import { db } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'

let _openai: OpenAI | undefined
function openai(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: env().OPENAI_API_KEY })
  return _openai
}

export interface PrSummaryInput {
  title: string
  authorLogin: string | null
  additions: number
  deletions: number
  outcome: {
    wasReverted: boolean
    downstreamFixCount: number
    ciFailureCount: number
    hadHotfixWithin7d: boolean
  }
}

/**
 * Returns a one-sentence, plain-English summary of why a PR is flagged as problematic.
 * Falls back to a deterministic string when the OpenAI monthly budget is exhausted
 * or when the API call fails. We never throw from this function.
 */
export async function summarizeProblemPR(pr: PrSummaryInput): Promise<string> {
  if (await isBudgetExceeded()) {
    return fallbackSummary(pr)
  }
  try {
    const res = await openai().chat.completions.create({
      model: env().OPENAI_MODEL,
      max_tokens: 80,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(pr) },
      ],
    })
    const choice = res.choices[0]
    const text = choice?.message?.content?.trim()
    const tokens = res.usage?.total_tokens ?? 0
    await recordUsage(tokens, env().OPENAI_MODEL)
    if (!text) return fallbackSummary(pr)
    return text
  } catch (err) {
    logger.warn({ err }, 'openai summary failed; using deterministic fallback')
    return fallbackSummary(pr)
  }
}

const SYSTEM_PROMPT = `You are a senior engineer writing a 1-sentence, factual summary of why a pull request is flagged as problematic. Write ONE sentence, max 20 words, factual, no speculation. Do not invent details that are not supported by the signals.`

function buildUserPrompt(pr: PrSummaryInput): string {
  return `PR title: "${pr.title}"
Changes: +${pr.additions}/-${pr.deletions} lines
Signals:
- Reverted: ${pr.outcome.wasReverted}
- Downstream fix PRs: ${pr.outcome.downstreamFixCount}
- CI failures: ${pr.outcome.ciFailureCount}
- Hotfix within 7 days: ${pr.outcome.hadHotfixWithin7d}

Write the one-sentence summary now.`
}

export function fallbackSummary(pr: PrSummaryInput): string {
  const parts: string[] = []
  if (pr.outcome.wasReverted) parts.push('reverted after merge')
  if (pr.outcome.downstreamFixCount > 0)
    parts.push(`${pr.outcome.downstreamFixCount} follow-up fix${pr.outcome.downstreamFixCount === 1 ? '' : 'es'}`)
  if (pr.outcome.hadHotfixWithin7d) parts.push('hotfix within 7 days')
  if (pr.outcome.ciFailureCount > 2) parts.push(`${pr.outcome.ciFailureCount} CI failures`)
  return parts.length > 0 ? `${pr.title} — ${parts.join(', ')}.` : `${pr.title} — flagged for review.`
}

// gpt-4o-mini: $0.15/1M input + $0.60/1M output ≈ $0.375/1M blended.
const COST_PER_TOKEN_USD = 0.375 / 1_000_000

async function recordUsage(tokens: number, model: string) {
  if (tokens <= 0) return
  const estimatedCostUsd = tokens * COST_PER_TOKEN_USD
  try {
    await db.insert(llmUsageLog).values({
      tokens,
      estimatedCostUsd,
      purpose: 'pr_summary',
      model,
    })
  } catch (err) {
    logger.warn({ err }, 'failed to record llm usage')
  }
}

export async function isBudgetExceeded(now: Date = new Date()): Promise<boolean> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const rows = await db
    .select({ cost: llmUsageLog.estimatedCostUsd })
    .from(llmUsageLog)
    .where(gte(llmUsageLog.createdAt, monthStart))
  const spent = rows.reduce((sum, r) => sum + (r.cost ?? 0), 0)
  return spent >= env().OPENAI_MONTHLY_BUDGET_USD
}

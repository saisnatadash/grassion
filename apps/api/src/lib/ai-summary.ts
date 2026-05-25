import Anthropic from '@anthropic-ai/sdk'
import { env } from '../env.js'

let client: Anthropic | null = null

function getClient(): Anthropic | null {
  const key = env().ANTHROPIC_API_KEY
  if (!key) return null
  if (!client) client = new Anthropic({ apiKey: key })
  return client
}

export interface PrSummaryInput {
  prTitle: string
  wasReverted: boolean | null
  triggeredHotfix: boolean | null
  changesRequestedCount: number
  ciFailureCount: number
  reworkScore: number
  aiSource: string | null
}

export async function generatePrSummary(pr: PrSummaryInput): Promise<string | null> {
  const anthropic = getClient()
  if (!anthropic) return null

  const signals: string[] = []
  if (pr.wasReverted) signals.push('was reverted')
  if (pr.triggeredHotfix) signals.push('triggered a hotfix within 7 days')
  if (pr.ciFailureCount > 0) signals.push(`had ${pr.ciFailureCount} CI failure(s)`)
  if (pr.changesRequestedCount >= 2) signals.push(`had ${pr.changesRequestedCount} review cycles`)
  if (pr.reworkScore > 50) signals.push(`high rework score (${pr.reworkScore})`)

  const prompt = `You are an engineering quality analyst. A pull request titled "${pr.prTitle}" ${
    pr.aiSource ? `(written with ${pr.aiSource}) ` : ''
  }has these quality signals: ${signals.join(', ')}.

Write a single sentence (max 20 words) explaining the most likely root cause of the quality issue. Be specific and actionable. Do not start with "This PR".`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 80,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = msg.content[0]
    return text?.type === 'text' ? text.text.trim() : null
  } catch {
    return null
  }
}

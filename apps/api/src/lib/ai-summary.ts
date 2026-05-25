import OpenAI from 'openai'
import { env } from '../env.js'

let client: OpenAI | null = null

function getClient(): OpenAI | null {
  const key = env().OPENAI_API_KEY ?? process.env['OPENAI_API_KEY']
  if (!key) return null
  if (!client) client = new OpenAI({ apiKey: key })
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
  const openai = getClient()
  if (!openai) return null

  const signals: string[] = []
  if (pr.wasReverted) signals.push('was reverted')
  if (pr.triggeredHotfix) signals.push('triggered a hotfix within 7 days')
  if (pr.ciFailureCount > 0) signals.push(`had ${pr.ciFailureCount} CI failure(s)`)
  if (pr.changesRequestedCount >= 2) signals.push(`had ${pr.changesRequestedCount} review cycles`)
  if (pr.reworkScore > 50) signals.push(`high rework score (${pr.reworkScore})`)

  const prompt = `You are an engineering quality analyst. A pull request titled "${pr.prTitle}"${
    pr.aiSource ? ` (written with ${pr.aiSource})` : ''
  } has these quality signals: ${signals.join(', ')}.

Write a single sentence (max 20 words) explaining the most likely root cause of the quality issue. Be specific and actionable. Do not start with "This PR".`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 80,
      messages: [{ role: 'user', content: prompt }],
    })
    return completion.choices[0]?.message.content?.trim() ?? null
  } catch {
    return null
  }
}

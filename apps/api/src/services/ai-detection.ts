import type { AiSource, AiDetectionMethod } from '@grassion/shared'

export interface DetectionResult {
  source: AiSource | null
  method: AiDetectionMethod | null
  confidence: number
}

export interface PRForDetection {
  body: string | null
  labels: string[]
  commits: Array<{ message: string; author: { name?: string; email?: string } }>
}

const TOOL_PATTERNS = {
  copilot: /copilot/i,
  cursor: /cursor/i,
  claude: /claude|anthropic/i,
  windsurf: /windsurf|codeium/i,
} as const

function identifyTool(text: string): AiSource {
  if (TOOL_PATTERNS.copilot.test(text)) return 'copilot'
  if (TOOL_PATTERNS.cursor.test(text)) return 'cursor'
  if (TOOL_PATTERNS.claude.test(text)) return 'claude'
  if (TOOL_PATTERNS.windsurf.test(text)) return 'windsurf'
  return 'unknown_ai'
}

export function detectAI(pr: PRForDetection): DetectionResult {
  // Priority 1: manual labels (1.0 confidence — explicit user signal).
  for (const label of pr.labels) {
    const m = label.match(/^grassion:ai-(copilot|cursor|claude|windsurf)$/)
    if (m) {
      return { source: m[1] as AiSource, method: 'label', confidence: 1.0 }
    }
    if (label === 'grassion:ai') {
      return { source: 'unknown_ai', method: 'label', confidence: 1.0 }
    }
    if (label === 'grassion:human') {
      return { source: null, method: 'label', confidence: 1.0 }
    }
  }

  // Priority 2: commit trailers (0.95 confidence — machine-emitted).
  for (const commit of pr.commits) {
    const lines = commit.message.split('\n')
    for (const line of lines) {
      const trailerMatch = line.match(/^Co-authored-by:\s*(.+?)\s*<(.+?)>$/i)
      if (!trailerMatch) continue
      const [, name, email] = trailerMatch
      if (!email) continue
      const combined = `${name ?? ''} ${email}`
      if (
        /copilot/i.test(combined) ||
        email.toLowerCase().includes('copilot@users.noreply.github.com')
      ) {
        return { source: 'copilot', method: 'trailer', confidence: 0.95 }
      }
      if (/claude|anthropic/i.test(combined)) {
        return { source: 'claude', method: 'trailer', confidence: 0.95 }
      }
      if (/cursor/i.test(combined)) {
        return { source: 'cursor', method: 'trailer', confidence: 0.95 }
      }
      if (/windsurf|codeium/i.test(combined)) {
        return { source: 'windsurf', method: 'trailer', confidence: 0.95 }
      }
    }
  }

  // Priority 3: PR body regex (0.70 confidence — author-described).
  if (pr.body) {
    const patterns: RegExp[] = [
      /generated (?:by|with|using) (copilot|cursor|claude|windsurf)/i,
      /(copilot|cursor|claude|windsurf) (?:wrote|authored|generated|assisted)/i,
      /🤖.*?(copilot|cursor|claude|windsurf)/i,
      /\b(?:ai[- ]?(?:generated|assisted|written))\b/i,
    ]
    for (const pattern of patterns) {
      const match = pr.body.match(pattern)
      if (match) {
        const source: AiSource = match[1] ? identifyTool(match[1]) : 'unknown_ai'
        return { source, method: 'body_regex', confidence: 0.7 }
      }
    }
  }

  return { source: null, method: null, confidence: 0 }
}

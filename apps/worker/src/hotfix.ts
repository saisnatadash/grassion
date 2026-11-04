import type { PullRequest } from '@grassion/db'

// Strong signals: at least one must be present for hadHotfix = true.
// off_hours is a weak signal — it adds weight but can never be the sole reason.
export const STRONG_HOTFIX_SIGNALS = new Set(['label', 'title_keyword', 'fast_merge', 'zero_review_fast'])

export async function checkHotfixWithin7d(pr: PullRequest): Promise<{ hadHotfix: boolean; hotfixSignals: string[] }> {
  if (!pr.mergedAt) return { hadHotfix: false, hotfixSignals: [] }
  const signals: string[] = []

  // Signal 1 — Labels on the PR itself (strong)
  const meta = (pr.rawMetadata ?? {}) as {
    labels?: Array<{ name: string }>
    reviews?: Array<{ state: string }>
  }
  const hasHotfixLabel = (meta.labels ?? []).some((l) =>
    /hotfix|urgent|critical|emergency|bug|incident|sev/i.test(l.name),
  )
  if (hasHotfixLabel) signals.push('label')

  // Signal 2 — Title keywords (strong)
  if (/\b(hotfix|fix|revert|incident|rollback|urgent|critical|emergency|patch)\b/i.test(pr.title)) {
    signals.push('title_keyword')
  }

  // Signal 3 — Fast merge: opened and merged within 30 minutes (strong)
  if (pr.openedAt) {
    const openToMergeMs = pr.mergedAt.getTime() - pr.openedAt.getTime()
    if (openToMergeMs <= 30 * 60 * 1000) signals.push('fast_merge')
  }

  // Signal 4 — Off-hours merge: outside 9am-6pm UTC on weekdays, or any weekend day (WEAK — adds weight only)
  const mergedHour = pr.mergedAt.getUTCHours()
  const mergedDay = pr.mergedAt.getUTCDay() // 0=Sun, 6=Sat
  const isWeekend = mergedDay === 0 || mergedDay === 6
  const isOffHours = mergedHour < 9 || mergedHour >= 18
  if (isWeekend || isOffHours) signals.push('off_hours')

  // Signal 5 — Zero review fast merge: no reviews AND merged within 2 hours (strong)
  const reviewCount = pr.reviewCount ?? 0
  const changesRequestedCount = pr.changesRequestedCount ?? 0
  if (pr.openedAt) {
    const openToMergeMs = pr.mergedAt.getTime() - pr.openedAt.getTime()
    if (reviewCount === 0 && changesRequestedCount === 0 && openToMergeMs <= 2 * 60 * 60 * 1000) {
      signals.push('zero_review_fast')
    }
  }

  // A PR is a hotfix candidate only when at least one STRONG signal is present.
  // off_hours alone is never sufficient — it inflates false positives for teams with async workflows.
  const hadHotfix = signals.some((s) => STRONG_HOTFIX_SIGNALS.has(s))
  return { hadHotfix, hotfixSignals: signals }
}

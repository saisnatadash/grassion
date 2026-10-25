// Pure labeling functions — no DB, no side-effects. Safe to unit-test in isolation.

export type PrSummary = {
  number: number
  title: string
  body: string | null
  mergedAt: string // ISO string
  headRefName: string // branch name
  labels: string[]
  additions: number
  deletions: number
  changedFiles: number
  authorLogin: string | null
  files: Array<{ filename: string; additions: number; deletions: number }>
}

export type LabelResult = {
  label: 'reverted' | 'hotfix' | null
  reason: string | null
  revertPrNumber: number | null
  hotfixPrNumber: number | null
  hasTestChanges: boolean
}

const REVERT_TITLE_RE = /^revert\s+"?(.+?)"?\s*$/i
const REVERT_BODY_RE = /reverts\s+#(\d+)/i
const HOTFIX_TITLE_RE = /^(\[hotfix\]|hotfix[/:!]|\bhotfix\b)/i
const TEST_FILE_RE = /(\btest\b|\bspec\b|__tests__|\.test\.|\.spec\.)/i

export function detectRevert(pr: PrSummary, allPrs: PrSummary[]): Pick<LabelResult, 'label' | 'reason' | 'revertPrNumber'> {
  // Priority 1: GitHub label "revert"
  if (pr.labels.some((l) => /^revert/i.test(l))) {
    return { label: 'reverted', reason: 'github_label', revertPrNumber: null }
  }

  // Priority 2: title matches "Revert "<original title>""
  const titleMatch = REVERT_TITLE_RE.exec(pr.title)
  if (titleMatch) {
    const originalTitle = titleMatch[1]!
    const original = allPrs.find(
      (p) => p.number !== pr.number && p.title.toLowerCase().includes(originalTitle.toLowerCase()),
    )
    return { label: 'reverted', reason: 'title_revert', revertPrNumber: original?.number ?? null }
  }

  // Priority 3: body contains "Reverts #<number>"
  if (pr.body) {
    const bodyMatch = REVERT_BODY_RE.exec(pr.body)
    if (bodyMatch) {
      return { label: 'reverted', reason: 'body_reverts', revertPrNumber: Number(bodyMatch[1]) }
    }
  }

  return { label: null, reason: null, revertPrNumber: null }
}

export function detectHotfix(pr: PrSummary, allPrs: PrSummary[]): Pick<LabelResult, 'label' | 'reason' | 'hotfixPrNumber'> {
  // Priority 1: GitHub label "hotfix"
  if (pr.labels.some((l) => /^hotfix/i.test(l))) {
    return { label: 'hotfix', reason: 'github_label', hotfixPrNumber: null }
  }

  // Priority 2: branch name starts with hotfix/
  if (/^hotfix\//i.test(pr.headRefName)) {
    return { label: 'hotfix', reason: 'branch_prefix', hotfixPrNumber: null }
  }

  // Priority 3: title matches hotfix pattern
  if (HOTFIX_TITLE_RE.test(pr.title)) {
    return { label: 'hotfix', reason: 'title_hotfix', hotfixPrNumber: null }
  }

  // Priority 4: tiny PR (≤20 LOC) merged within 24h of a previous merged PR
  // and title contains "fix" — heuristic for emergency patches
  if (pr.additions + pr.deletions <= 20) {
    const mergedAt = new Date(pr.mergedAt).getTime()
    const prevPr = allPrs.find((p) => {
      if (p.number === pr.number || !p.mergedAt) return false
      const diff = mergedAt - new Date(p.mergedAt).getTime()
      return diff >= 0 && diff <= 86_400_000 && /fix/i.test(pr.title)
    })
    if (prevPr) {
      return { label: 'hotfix', reason: 'tiny_fix_after_recent_merge', hotfixPrNumber: prevPr.number }
    }
  }

  return { label: null, reason: null, hotfixPrNumber: null }
}

export function labelPr(pr: PrSummary, allPrs: PrSummary[]): LabelResult {
  const hasTestChanges = pr.files.some((f) => TEST_FILE_RE.test(f.filename))

  // Revert takes precedence over hotfix
  const revert = detectRevert(pr, allPrs)
  if (revert.label) {
    return { ...revert, hotfixPrNumber: null, hasTestChanges }
  }

  const hotfix = detectHotfix(pr, allPrs)
  if (hotfix.label) {
    return { ...hotfix, revertPrNumber: null, hasTestChanges }
  }

  return { label: null, reason: null, revertPrNumber: null, hotfixPrNumber: null, hasTestChanges }
}

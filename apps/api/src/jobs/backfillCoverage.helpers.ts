/**
 * Pure helper functions for the Human Coverage backfill.
 * No DB or GitHub imports — safe to import in unit tests.
 */

// ── Evidence weights ──────────────────────────────────────────────────────────

/**
 * Minimum decayed evidence score for a person to count as a "qualified knower"
 * of an area. Used for Key-Person Exposure % calculation only — the existing
 * single-person-area display uses weight > 0.
 * Keep as a named constant so the threshold can be tuned after backtest.
 */
export const MIN_EVIDENCE = 1.0

export const EVIDENCE_WEIGHTS: Record<string, number> = {
  incident_fix: 3.0,
  successful_edit: 1.0,         // PR author (normal merged PR, not reverted)
  review_with_comment: 0.6,     // APPROVED/CHANGES_REQUESTED review with non-empty body
  approval_only: 0.15,          // APPROVED review with no comment body
  // Legacy type for existing DB rows — kept so old evidence is not silently dropped
  substantive_review: 0.7,
  answered_question: 0.5,
  understanding_click: 0.3,
  explain_back: 0.5,
  large_ai_change_unreviewed: -0.5,
}

// ── Recency decay ─────────────────────────────────────────────────────────────

/**
 * 90-day half-life decay. Applied at query time — stored weights are never changed.
 * Evidence from today returns 1.0; evidence from 90 days ago returns 0.5; 180d → 0.25.
 */
export function decayFactor(eventDate: Date): number {
  const daysSince = (Date.now() - eventDate.getTime()) / 86_400_000
  return Math.pow(0.5, daysSince / 90)
}

// ── Path boost ────────────────────────────────────────────────────────────────

/**
 * Matches on path SEGMENTS only — "auth/" matches, but "author/" does not.
 * Boosts high-value areas 1.5x for the Key-Person Exposure weight calculation.
 */
const PATH_BOOST_SEGMENTS =
  /(?:^|\/)(?:auth|payments?|billing|checkout|migrations?|infra|security|secrets|deploy)(?:\/|$|\.[^/]*$)/i

export function pathBoostFactor(filePath: string): number {
  return PATH_BOOST_SEGMENTS.test(filePath) ? 1.5 : 1.0
}

// ── Area path extraction ──────────────────────────────────────────────────────

/**
 * Returns the top-2-directory prefix of a file path.
 * "src/services/auth.ts" → "src/services"
 * "index.ts"             → "."
 * "apps/api/src/main.ts" → "apps/api"
 */
export function extractAreaPath(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 1) return '.'
  if (parts.length === 2) return parts[0]!
  return `${parts[0]}/${parts[1]}`
}

// ── PR title classifiers ──────────────────────────────────────────────────────

export function isRevertTitle(title: string): boolean {
  return /^Revert\s+["']/.test(title.trim())
}

export function isHotfixTitle(title: string): boolean {
  return /\b(hotfix|hot[- ]fix|urgent[- ]fix|critical[- ]fix|emergency)\b/i.test(title)
}

/** PR that explicitly references closing/fixing another PR or issue. */
export function isExplicitFixTitle(title: string): boolean {
  return /\b(fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#\d+/i.test(title)
}

// ── Revert/hotfix maps ────────────────────────────────────────────────────────

/** Minimal PR shape needed for phase-1 scanning (list-API response). */
export interface ScannedPr {
  number: number
  title: string
  body: string | null
  merged_at: string | null
  user: { login: string; id: number } | null
  labels: Array<{ name: string }>
  additions: number
  deletions: number
  changed_files: number
  commit_count: number
  html_url: string
}

export interface RevertMaps {
  /** PR numbers that were reverted by another PR in the same set. */
  revertedPrNumbers: Set<number>
  /** original PR number → the revert PR number */
  revertByOriginal: Map<number, number>
  /** PR numbers identified as hotfixes. */
  hotfixPrNumbers: Set<number>
}

/**
 * Scans a list of merged PRs and builds revert/hotfix maps.
 * Pure function — safe to call in tests without a DB or GitHub client.
 */
export function buildRevertMaps(prs: ScannedPr[]): RevertMaps {
  const titleToNumber = new Map<string, number>()
  const revertedPrNumbers = new Set<number>()
  const revertByOriginal = new Map<number, number>()
  const hotfixPrNumbers = new Set<number>()

  for (const pr of prs) {
    if (pr.merged_at) titleToNumber.set(pr.title, pr.number)
  }

  for (const pr of prs) {
    if (!pr.merged_at) continue

    if (isHotfixTitle(pr.title)) hotfixPrNumbers.add(pr.number)

    if (isRevertTitle(pr.title)) {
      // GitHub's revert titles look like: Revert "original PR title"
      const m = pr.title.match(/^Revert\s+["'](.+?)["']/)
      if (m) {
        const origTitle = m[1]!
        const origNumber = titleToNumber.get(origTitle)
        if (origNumber !== undefined) {
          revertedPrNumbers.add(origNumber)
          revertByOriginal.set(origNumber, pr.number)
        }
      }
    }
  }

  return { revertedPrNumbers, revertByOriginal, hotfixPrNumbers }
}

// ── File privacy helper ───────────────────────────────────────────────────────

export interface SafePrFile {
  filename: string
  status: string
  additions: number
  deletions: number
}

/** Strips all fields except filename/status/additions/deletions. Patch is never stored. */
export function sanitizeFile(raw: {
  filename: string
  status: string
  additions: number
  deletions: number
  [key: string]: unknown
}): SafePrFile {
  return {
    filename: raw.filename,
    status: raw.status,
    additions: raw.additions,
    deletions: raw.deletions,
  }
}

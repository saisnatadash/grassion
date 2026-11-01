import { describe, it, expect } from 'vitest'
import {
  extractAreaPath,
  isRevertTitle,
  isHotfixTitle,
  isExplicitFixTitle,
  buildRevertMaps,
  type ScannedPr,
} from './backfillCoverage.helpers.js'
import prListFixture from './__fixtures__/pr-list.json' assert { type: 'json' }

// ── extractAreaPath ───────────────────────────────────────────────────────────

describe('extractAreaPath', () => {
  it('returns "." for a root-level file', () => {
    expect(extractAreaPath('index.ts')).toBe('.')
  })

  it('returns the first segment for a top-level directory file', () => {
    expect(extractAreaPath('src/main.ts')).toBe('src')
  })

  it('returns top-2 segments for a deeply nested file', () => {
    expect(extractAreaPath('src/services/auth/jwt.ts')).toBe('src/services')
  })

  it('returns top-2 segments for exactly 3 parts', () => {
    expect(extractAreaPath('apps/api/index.ts')).toBe('apps/api')
  })

  it('handles monorepo-style paths', () => {
    expect(extractAreaPath('packages/db/src/schema.ts')).toBe('packages/db')
  })

  it('handles a file with no directory (no slash)', () => {
    expect(extractAreaPath('README.md')).toBe('.')
  })
})

// ── isRevertTitle ─────────────────────────────────────────────────────────────

describe('isRevertTitle', () => {
  it('recognises double-quoted revert title', () => {
    expect(isRevertTitle('Revert "feat: add user auth endpoint"')).toBe(true)
  })

  it('recognises single-quoted revert title', () => {
    expect(isRevertTitle("Revert 'fix: something'")).toBe(true)
  })

  it('returns false for normal PR titles', () => {
    expect(isRevertTitle('feat: add login')).toBe(false)
  })

  it('returns false for "Revert" without a quote', () => {
    expect(isRevertTitle('Revert changes from last sprint')).toBe(false)
  })

  it('is case-sensitive (GitHub always writes "Revert" with a capital R)', () => {
    expect(isRevertTitle('revert "feat: add login"')).toBe(false)
  })
})

// ── isHotfixTitle ─────────────────────────────────────────────────────────────

describe('isHotfixTitle', () => {
  it('matches "hotfix:" prefix', () => {
    expect(isHotfixTitle('hotfix: patch token expiry')).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(isHotfixTitle('HOTFIX: critical patch')).toBe(true)
  })

  it('matches "hot-fix"', () => {
    expect(isHotfixTitle('hot-fix: urgent db patch')).toBe(true)
  })

  it('matches "emergency"', () => {
    expect(isHotfixTitle('emergency: payment service down')).toBe(true)
  })

  it('returns false for normal PR title', () => {
    expect(isHotfixTitle('feat: add settings page')).toBe(false)
  })
})

// ── isExplicitFixTitle ────────────────────────────────────────────────────────

describe('isExplicitFixTitle', () => {
  it('matches "fixes #42"', () => {
    expect(isExplicitFixTitle('fixes #42: broken login')).toBe(true)
  })

  it('matches "closes #10"', () => {
    expect(isExplicitFixTitle('refactor: closes #10')).toBe(true)
  })

  it('matches "resolves #5"', () => {
    expect(isExplicitFixTitle('resolves #5')).toBe(true)
  })

  it('returns false without a PR/issue reference', () => {
    expect(isExplicitFixTitle('fix: typo in readme')).toBe(false)
  })
})

// ── buildRevertMaps ───────────────────────────────────────────────────────────

describe('buildRevertMaps', () => {
  const prs = prListFixture as ScannedPr[]

  it('identifies PR #10 as reverted by PR #12', () => {
    const maps = buildRevertMaps(prs)
    expect(maps.revertedPrNumbers.has(10)).toBe(true)
    expect(maps.revertByOriginal.get(10)).toBe(12)
  })

  it('does not mark PR #11 (AI, not reverted) as reverted', () => {
    const maps = buildRevertMaps(prs)
    expect(maps.revertedPrNumbers.has(11)).toBe(false)
  })

  it('identifies PR #13 as a hotfix', () => {
    const maps = buildRevertMaps(prs)
    expect(maps.hotfixPrNumbers.has(13)).toBe(true)
  })

  it('does not mark normal PRs as hotfixes', () => {
    const maps = buildRevertMaps(prs)
    expect(maps.hotfixPrNumbers.has(10)).toBe(false)
    expect(maps.hotfixPrNumbers.has(14)).toBe(false)
  })

  it('returns empty maps for an empty list', () => {
    const maps = buildRevertMaps([])
    expect(maps.revertedPrNumbers.size).toBe(0)
    expect(maps.revertByOriginal.size).toBe(0)
    expect(maps.hotfixPrNumbers.size).toBe(0)
  })

  it('handles revert of an unrecognised title gracefully', () => {
    const fakePrs: ScannedPr[] = [
      {
        number: 99,
        title: 'Revert "some PR that is not in the list"',
        body: null,
        merged_at: '2026-10-20T10:00:00Z',
        user: { login: 'dev', id: 1 },
        labels: [],
        additions: 0,
        deletions: 10,
        changed_files: 1,
        commit_count: 1,
        html_url: 'https://github.com/acme/api/pull/99',
      },
    ]
    const maps = buildRevertMaps(fakePrs)
    // Revert PR itself is not marked as reverted — no original found
    expect(maps.revertedPrNumbers.size).toBe(0)
  })
})

// ── Privacy: fixture files must not contain a patch field ─────────────────────

describe('fixture privacy check', () => {
  it('pr-files.json entries have no patch field', async () => {
    const { default: prFiles } = await import('./__fixtures__/pr-files.json', {
      assert: { type: 'json' },
    })
    const files = Object.values(prFiles as Record<string, unknown[]>).flat()
    for (const file of files) {
      expect(Object.keys(file as object)).not.toContain('patch')
    }
  })
})

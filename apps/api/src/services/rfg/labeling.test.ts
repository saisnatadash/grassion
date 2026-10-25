import { describe, it, expect } from 'vitest'
import { labelPr, detectRevert, detectHotfix, type PrSummary } from './labeling.js'

const base: PrSummary = {
  number: 42,
  title: 'feat: add login button',
  body: null,
  mergedAt: '2024-01-15T10:00:00Z',
  headRefName: 'feature/login',
  labels: [],
  additions: 50,
  deletions: 10,
  changedFiles: 3,
  authorLogin: 'alice',
  files: [
    { filename: 'src/login.ts', additions: 40, deletions: 8 },
    { filename: 'src/auth.ts', additions: 10, deletions: 2 },
  ],
}

const allPrs: PrSummary[] = [base]

// ─── detectRevert ────────────────────────────────────────────────────────────

describe('detectRevert', () => {
  it('detects via github label', () => {
    const pr = { ...base, labels: ['revert'] }
    const r = detectRevert(pr, allPrs)
    expect(r.label).toBe('reverted')
    expect(r.reason).toBe('github_label')
  })

  it('detects via title "Revert \\"<title>\\""', () => {
    const original = { ...base, number: 41, title: 'feat: add login button' }
    const pr = { ...base, number: 42, title: 'Revert "feat: add login button"' }
    const r = detectRevert(pr, [original, pr])
    expect(r.label).toBe('reverted')
    expect(r.reason).toBe('title_revert')
    expect(r.revertPrNumber).toBe(41)
  })

  it('detects via body "Reverts #41"', () => {
    const pr = { ...base, body: 'This PR undoes the changes.\n\nReverts #41', number: 42 }
    const r = detectRevert(pr, allPrs)
    expect(r.label).toBe('reverted')
    expect(r.reason).toBe('body_reverts')
    expect(r.revertPrNumber).toBe(41)
  })

  it('does not false-positive on normal PR', () => {
    const r = detectRevert(base, allPrs)
    expect(r.label).toBeNull()
  })

  it('does not false-positive on title that only mentions revert in description', () => {
    const pr = { ...base, title: 'feat: handle revert edge case in parser' }
    const r = detectRevert(pr, allPrs)
    expect(r.label).toBeNull()
  })
})

// ─── detectHotfix ────────────────────────────────────────────────────────────

describe('detectHotfix', () => {
  it('detects via github label', () => {
    const pr = { ...base, labels: ['hotfix'] }
    const r = detectHotfix(pr, allPrs)
    expect(r.label).toBe('hotfix')
    expect(r.reason).toBe('github_label')
  })

  it('detects via branch prefix hotfix/', () => {
    const pr = { ...base, headRefName: 'hotfix/critical-auth-bug' }
    const r = detectHotfix(pr, allPrs)
    expect(r.label).toBe('hotfix')
    expect(r.reason).toBe('branch_prefix')
  })

  it('detects via [hotfix] title prefix', () => {
    const pr = { ...base, title: '[hotfix] fix null pointer in payment' }
    const r = detectHotfix(pr, allPrs)
    expect(r.label).toBe('hotfix')
    expect(r.reason).toBe('title_hotfix')
  })

  it('detects via hotfix: title prefix', () => {
    const pr = { ...base, title: 'hotfix: broken redirect on logout' }
    const r = detectHotfix(pr, allPrs)
    expect(r.label).toBe('hotfix')
    expect(r.reason).toBe('title_hotfix')
  })

  it('detects tiny fix merged within 24h of previous PR', () => {
    const prev = { ...base, number: 41, mergedAt: '2024-01-15T08:00:00Z' }
    const pr = {
      ...base,
      number: 42,
      title: 'fix: null crash on logout',
      mergedAt: '2024-01-15T10:00:00Z',
      additions: 5,
      deletions: 3,
    }
    const r = detectHotfix(pr, [prev, pr])
    expect(r.label).toBe('hotfix')
    expect(r.reason).toBe('tiny_fix_after_recent_merge')
    expect(r.hotfixPrNumber).toBe(41)
  })

  it('does not false-positive on normal PR', () => {
    const r = detectHotfix(base, allPrs)
    expect(r.label).toBeNull()
  })

  it('does not false-positive when tiny fix is older than 24h', () => {
    const prev = { ...base, number: 41, mergedAt: '2024-01-13T08:00:00Z' }
    const pr = {
      ...base,
      number: 42,
      title: 'fix: null crash',
      mergedAt: '2024-01-15T10:00:00Z',
      additions: 5,
      deletions: 3,
    }
    const r = detectHotfix(pr, [prev, pr])
    expect(r.label).toBeNull()
  })
})

// ─── labelPr ─────────────────────────────────────────────────────────────────

describe('labelPr', () => {
  it('revert wins over hotfix when both match', () => {
    const pr = {
      ...base,
      title: 'Revert "feat: add login button"',
      headRefName: 'hotfix/revert-login',
      labels: [],
    }
    const result = labelPr(pr, [base, pr])
    expect(result.label).toBe('reverted')
  })

  it('detects test changes in files', () => {
    const pr = {
      ...base,
      files: [
        { filename: 'src/login.ts', additions: 10, deletions: 0 },
        { filename: 'src/login.test.ts', additions: 20, deletions: 0 },
      ],
    }
    const result = labelPr(pr, [pr])
    expect(result.hasTestChanges).toBe(true)
  })

  it('returns null label for a plain PR', () => {
    const result = labelPr(base, allPrs)
    expect(result.label).toBeNull()
    expect(result.reason).toBeNull()
  })
})

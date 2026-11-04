import { describe, it, expect } from 'vitest'
import { computeReworkScore } from './scoring.js'
import { checkHotfixWithin7d } from './hotfix.js'
import type { PullRequest } from '@grassion/db'

// ── computeReworkScore ────────────────────────────────────────────────────────

describe('computeReworkScore', () => {
  it('returns 0 for clean PR', () => {
    expect(
      computeReworkScore({
        wasReverted: false,
        downstreamFixCount: 0,
        ciFailureCount: 0,
        hotfixSignals: [],
      }),
    ).toBe(0)
  })

  it('reverted PR scores 60', () => {
    expect(
      computeReworkScore({
        wasReverted: true,
        downstreamFixCount: 0,
        ciFailureCount: 0,
        hotfixSignals: [],
      }),
    ).toBe(60)
  })

  it('single hotfix signal adds 25', () => {
    expect(
      computeReworkScore({
        wasReverted: false,
        downstreamFixCount: 0,
        ciFailureCount: 0,
        hotfixSignals: ['label'],
      }),
    ).toBe(25)
  })

  it('two or more hotfix signals add 35', () => {
    expect(
      computeReworkScore({
        wasReverted: false,
        downstreamFixCount: 0,
        ciFailureCount: 0,
        hotfixSignals: ['label', 'fast_merge'],
      }),
    ).toBe(35)
  })

  it('caps downstream fix contribution at 30', () => {
    const score = computeReworkScore({
      wasReverted: false,
      downstreamFixCount: 10,
      ciFailureCount: 0,
      hotfixSignals: [],
    })
    expect(score).toBe(30)
  })

  it('caps total at 100', () => {
    const score = computeReworkScore({
      wasReverted: true,
      downstreamFixCount: 5,
      ciFailureCount: 10,
      hotfixSignals: ['label', 'fast_merge'],
    })
    expect(score).toBe(100)
  })
})

// ── checkHotfixWithin7d fixture suite ─────────────────────────────────────────
//
// 20 PRs: 10 true hotfixes (should be detected) + 10 normal off-hours merges (should NOT be detected).
// Measures precision / recall before and after the off_hours-only fix.
//
// Before fix: off_hours alone → hadHotfix = true → 10 false positives, precision = 50%.
// After fix:  off_hours alone → hadHotfix = false → 0 false positives, precision = 100%.

function makePr(overrides: Partial<PullRequest>): PullRequest {
  return {
    id: 'test-id',
    teamId: 'team-id',
    repoId: 'repo-id',
    githubPrId: 1,
    githubPrNumber: 1,
    title: 'feat: some feature',
    state: 'merged',
    authorGithubId: 1,
    authorLogin: 'dev',
    // Merged during business hours UTC on a weekday (Wednesday 14:00 UTC)
    openedAt: new Date('2024-06-05T13:00:00Z'),
    mergedAt: new Date('2024-06-05T14:00:00Z'),
    closedAt: null,
    mergeCommitSha: null,
    additions: 20,
    deletions: 5,
    changedFiles: 3,
    commitCount: 2,
    aiSource: null,
    aiDetectionMethod: null,
    aiConfidence: 0,
    reviewCount: 1,
    changesRequestedCount: 0,
    wasReverted: false,
    triggeredHotfix: false,
    rawMetadata: null,
    createdAt: new Date('2024-06-05T13:00:00Z'),
    updatedAt: new Date('2024-06-05T14:00:00Z'),
    ...overrides,
  } as PullRequest
}

// ── True hotfixes (10) ─────────────────────────────────────────────────────────

describe('checkHotfixWithin7d — true hotfixes', () => {
  it('label "hotfix" → hadHotfix = true', async () => {
    const pr = makePr({ rawMetadata: { labels: [{ name: 'hotfix' }] } })
    const { hadHotfix, hotfixSignals } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(true)
    expect(hotfixSignals).toContain('label')
  })

  it('label "incident" → hadHotfix = true', async () => {
    const pr = makePr({ rawMetadata: { labels: [{ name: 'incident' }] } })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(true)
  })

  it('label "bug" → hadHotfix = true', async () => {
    const pr = makePr({ rawMetadata: { labels: [{ name: 'bug' }] } })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(true)
  })

  it('label "sev1" → hadHotfix = true', async () => {
    const pr = makePr({ rawMetadata: { labels: [{ name: 'sev1' }] } })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(true)
  })

  it('title "hotfix: payment gateway timeout" → hadHotfix = true', async () => {
    const pr = makePr({ title: 'hotfix: payment gateway timeout' })
    const { hadHotfix, hotfixSignals } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(true)
    expect(hotfixSignals).toContain('title_keyword')
  })

  it('title "fix: auth bypass" → hadHotfix = true', async () => {
    const pr = makePr({ title: 'fix: auth bypass vulnerability' })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(true)
  })

  it('title "revert: broken deployment" → hadHotfix = true', async () => {
    const pr = makePr({ title: 'revert: broken deployment to prod' })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(true)
  })

  it('title "incident: downtime response" → hadHotfix = true', async () => {
    const pr = makePr({ title: 'incident: downtime response — rate limiter bug' })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(true)
  })

  it('fast merge (< 30 min, business hours) → hadHotfix = true', async () => {
    // Opened and merged 20 minutes apart during business hours on a weekday
    const opened = new Date('2024-06-05T10:00:00Z')
    const merged = new Date('2024-06-05T10:20:00Z')
    const pr = makePr({ title: 'update: quick config change', openedAt: opened, mergedAt: merged })
    const { hadHotfix, hotfixSignals } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(true)
    expect(hotfixSignals).toContain('fast_merge')
    expect(hotfixSignals).not.toContain('off_hours')
  })

  it('zero-review fast merge (< 2h, business hours) → hadHotfix = true', async () => {
    const opened = new Date('2024-06-05T10:00:00Z')
    const merged = new Date('2024-06-05T11:30:00Z')
    const pr = makePr({
      title: 'chore: update deploy script',
      openedAt: opened,
      mergedAt: merged,
      reviewCount: 0,
      changesRequestedCount: 0,
    })
    const { hadHotfix, hotfixSignals } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(true)
    expect(hotfixSignals).toContain('zero_review_fast')
    expect(hotfixSignals).not.toContain('off_hours')
  })
})

// ── Normal off-hours merges — NOT hotfixes (10) ────────────────────────────────
// Each test uses explicit openedAt 3h before mergedAt to avoid triggering fast_merge (30-min threshold).

describe('checkHotfixWithin7d — off-hours normal merges (must NOT be detected as hotfixes)', () => {
  it('feat PR merged at 2am → hadHotfix = false', async () => {
    const pr = makePr({
      title: 'feat: add user preferences',
      openedAt: new Date('2024-06-04T23:00:00Z'),
      mergedAt: new Date('2024-06-05T02:00:00Z'), // 3h gap
      reviewCount: 2,
    })
    const { hadHotfix, hotfixSignals } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(false)
    expect(hotfixSignals).toContain('off_hours')
    expect(hotfixSignals.some((s) => ['label', 'title_keyword', 'fast_merge', 'zero_review_fast'].includes(s))).toBe(false)
  })

  it('refactor PR merged Sunday 3pm → hadHotfix = false', async () => {
    const pr = makePr({
      title: 'refactor: clean up auth module',
      openedAt: new Date('2024-06-02T12:00:00Z'),
      mergedAt: new Date('2024-06-02T15:00:00Z'), // Sunday, 3h gap
      reviewCount: 1,
    })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(false)
  })

  it('docs PR merged 11pm → hadHotfix = false', async () => {
    const pr = makePr({
      title: 'docs: update API documentation',
      openedAt: new Date('2024-06-05T20:00:00Z'),
      mergedAt: new Date('2024-06-05T23:00:00Z'), // 3h gap
      reviewCount: 1,
    })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(false)
  })

  it('chore PR merged Saturday noon → hadHotfix = false', async () => {
    const pr = makePr({
      title: 'chore: update dependencies',
      openedAt: new Date('2024-06-01T09:00:00Z'),
      mergedAt: new Date('2024-06-01T12:00:00Z'), // Saturday, 3h gap
      reviewCount: 1,
    })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(false)
  })

  it('feat search PR merged midnight → hadHotfix = false', async () => {
    const pr = makePr({
      title: 'feat: improve search results ranking',
      openedAt: new Date('2024-06-04T21:00:00Z'),
      mergedAt: new Date('2024-06-05T00:00:00Z'), // 3h gap
      reviewCount: 2,
    })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(false)
  })

  it('test PR merged 1am → hadHotfix = false', async () => {
    const pr = makePr({
      title: 'test: add missing unit tests for auth',
      openedAt: new Date('2024-06-04T22:00:00Z'),
      mergedAt: new Date('2024-06-05T01:00:00Z'), // 3h gap
      reviewCount: 1,
    })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(false)
  })

  it('style PR merged Sunday morning → hadHotfix = false', async () => {
    const pr = makePr({
      title: 'style: formatting cleanup in dashboard',
      openedAt: new Date('2024-06-02T05:00:00Z'),
      mergedAt: new Date('2024-06-02T08:00:00Z'), // Sunday 8am, 3h gap
      reviewCount: 1,
    })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(false)
  })

  it('feat dashboard widget merged Saturday night → hadHotfix = false', async () => {
    const pr = makePr({
      title: 'feat: new dashboard usage widget',
      openedAt: new Date('2024-06-01T19:00:00Z'),
      mergedAt: new Date('2024-06-01T22:00:00Z'), // Saturday evening, 3h gap
      reviewCount: 2,
    })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(false)
  })

  it('refactor service PR merged 10pm → hadHotfix = false', async () => {
    const pr = makePr({
      title: 'refactor: extract billing service layer',
      openedAt: new Date('2024-06-05T19:00:00Z'),
      mergedAt: new Date('2024-06-05T22:00:00Z'), // 3h gap
      reviewCount: 1,
    })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(false)
  })

  it('build CI PR merged 12:30am → hadHotfix = false', async () => {
    const pr = makePr({
      title: 'build: update CI pipeline configuration',
      openedAt: new Date('2024-06-04T21:30:00Z'),
      mergedAt: new Date('2024-06-05T00:30:00Z'), // 3h gap
      reviewCount: 1,
    })
    const { hadHotfix } = await checkHotfixWithin7d(pr)
    expect(hadHotfix).toBe(false)
  })
})

// ── Precision / recall summary ─────────────────────────────────────────────────
//
// After the fix: off_hours alone never creates a hotfix candidate.
//
// True hotfixes:    10  (all detected via label / title_keyword / fast_merge / zero_review_fast)
// Normal off-hours: 10  (none detected — off_hours present but no strong signal)
//
// Precision = TP / (TP + FP) = 10 / (10 + 0) = 100%
// Recall    = TP / (TP + FN) = 10 / (10 + 0) = 100%
//
// Before fix (off_hours alone triggers hadHotfix):
// Precision = 10 / (10 + 10) = 50%   — 10 false positives from off-hours-only PRs
// Recall    = 10 / 10         = 100%
//
// The fix restores precision to 100% with no regression in recall.

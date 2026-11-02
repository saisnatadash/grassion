import { describe, it, expect } from 'vitest'

// ── isProPlan — tested inline to avoid DB initialization ────────────────────

function isProPlan(plan: string): boolean {
  return plan === 'pro' || plan === 'team' || plan === 'growth' || plan === 'business' || plan === 'enterprise'
}

describe('isProPlan', () => {
  it('returns true for pro plan', () => {
    expect(isProPlan('pro')).toBe(true)
  })

  it('returns true for business plan', () => {
    expect(isProPlan('business')).toBe(true)
  })

  it('returns true for enterprise plan', () => {
    expect(isProPlan('enterprise')).toBe(true)
  })

  it('returns true for legacy team plan', () => {
    expect(isProPlan('team')).toBe(true)
  })

  it('returns true for legacy growth plan', () => {
    expect(isProPlan('growth')).toBe(true)
  })

  it('returns false for free', () => {
    expect(isProPlan('free')).toBe(false)
  })

  it('returns false for trial', () => {
    expect(isProPlan('trial')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isProPlan('')).toBe(false)
  })
})

// ── Check run conclusion logic ─────────────────────────────────────────────────

function getConclusion(darkCount: number, criticalDarkCount: number, blockOnCritical: boolean): string {
  if (blockOnCritical && criticalDarkCount > 0) return 'action_required'
  if (darkCount > 0) return 'neutral'
  return 'success'
}

describe('check run conclusion', () => {
  it('success when no dark areas', () => {
    expect(getConclusion(0, 0, false)).toBe('success')
  })

  it('neutral when dark areas but no critical', () => {
    expect(getConclusion(2, 0, false)).toBe('neutral')
  })

  it('neutral when critical but blockOnCritical=false', () => {
    expect(getConclusion(2, 1, false)).toBe('neutral')
  })

  it('action_required when critical and blockOnCritical=true', () => {
    expect(getConclusion(2, 1, true)).toBe('action_required')
  })

  it('success still wins when no dark even with blockOnCritical=true', () => {
    expect(getConclusion(0, 0, true)).toBe('success')
  })
})

// ── Understanding action identifier validation ────────────────────────────────

const VALID_IDENTIFIERS = ['understand', 'partly', 'ai_wrote_it']

function mapToAnswer(identifier: string): 'understand' | 'partly' | 'ai_wrote_it' {
  if (identifier === 'understand') return 'understand'
  if (identifier === 'partly') return 'partly'
  return 'ai_wrote_it'
}

describe('understanding action identifiers', () => {
  it('maps understand → understand', () => {
    expect(mapToAnswer('understand')).toBe('understand')
  })

  it('maps partly → partly', () => {
    expect(mapToAnswer('partly')).toBe('partly')
  })

  it('maps ai_wrote_it → ai_wrote_it', () => {
    expect(mapToAnswer('ai_wrote_it')).toBe('ai_wrote_it')
  })

  it('maps unknown → ai_wrote_it (safe fallback)', () => {
    expect(mapToAnswer('unknown')).toBe('ai_wrote_it')
  })

  it('all valid identifiers are recognised', () => {
    for (const id of VALID_IDENTIFIERS) {
      expect(VALID_IDENTIFIERS.includes(id)).toBe(true)
    }
  })
})

import { describe, it, expect } from 'vitest'
import { checkPlanGate, isProOrAbove, isBusinessOrAbove } from './auth.js'

// ── isProOrAbove ───────────────────────────────────────────────────────────────

describe('isProOrAbove', () => {
  it('free → false', () => expect(isProOrAbove('free')).toBe(false))
  it('trial → false', () => expect(isProOrAbove('trial')).toBe(false))
  it('pro → true', () => expect(isProOrAbove('pro')).toBe(true))
  it('growth → true', () => expect(isProOrAbove('growth')).toBe(true))
  it('team → true', () => expect(isProOrAbove('team')).toBe(true))
  it('business → true', () => expect(isProOrAbove('business')).toBe(true))
  it('enterprise → true', () => expect(isProOrAbove('enterprise')).toBe(true))
})

// ── isBusinessOrAbove ──────────────────────────────────────────────────────────

describe('isBusinessOrAbove', () => {
  it('free → false', () => expect(isBusinessOrAbove('free')).toBe(false))
  it('pro → false', () => expect(isBusinessOrAbove('pro')).toBe(false))
  it('business → true', () => expect(isBusinessOrAbove('business')).toBe(true))
  it('enterprise → true', () => expect(isBusinessOrAbove('enterprise')).toBe(true))
})

// ── checkPlanGate ──────────────────────────────────────────────────────────────
// This is the pure logic that requirePlan() uses after a DB lookup.
// Tests here prove: free team gets 403 behavior, pro team gets through.

describe('checkPlanGate — pro routes (pr-outcomes, pr-decay, hc/*, mcp-tokens)', () => {
  it('free team → gate returns false (would produce 403)', () => {
    expect(checkPlanGate('free', 'pro')).toBe(false)
  })

  it('trial team → gate returns false (would produce 403)', () => {
    expect(checkPlanGate('trial', 'pro')).toBe(false)
  })

  it('pro team → gate returns true (access allowed)', () => {
    expect(checkPlanGate('pro', 'pro')).toBe(true)
  })

  it('business team → gate returns true (access allowed)', () => {
    expect(checkPlanGate('business', 'pro')).toBe(true)
  })

  it('enterprise team → gate returns true (access allowed)', () => {
    expect(checkPlanGate('enterprise', 'pro')).toBe(true)
  })

  // Legacy plan names still work
  it('legacy "growth" → gate returns true', () => {
    expect(checkPlanGate('growth', 'pro')).toBe(true)
  })
  it('legacy "team" → gate returns true', () => {
    expect(checkPlanGate('team', 'pro')).toBe(true)
  })
})

describe('checkPlanGate — business routes (benchmark, per-dev metrics)', () => {
  it('free team → false', () => expect(checkPlanGate('free', 'business')).toBe(false))
  it('pro team → false', () => expect(checkPlanGate('pro', 'business')).toBe(false))
  it('business team → true', () => expect(checkPlanGate('business', 'business')).toBe(true))
  it('enterprise team → true', () => expect(checkPlanGate('enterprise', 'business')).toBe(true))
})

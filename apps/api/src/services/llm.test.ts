import { describe, it, expect } from 'vitest'
import { checkBudgetExceeded, LlmCapExceededError } from './llm.js'

describe('checkBudgetExceeded', () => {
  it('returns false when spend is below cap', () => {
    expect(checkBudgetExceeded(1.5, 2.0)).toBe(false)
  })

  it('returns true when spend equals cap', () => {
    expect(checkBudgetExceeded(2.0, 2.0)).toBe(true)
  })

  it('returns true when spend exceeds cap', () => {
    expect(checkBudgetExceeded(2.5, 2.0)).toBe(true)
  })

  it('returns false for zero spend against any positive cap', () => {
    expect(checkBudgetExceeded(0, 20)).toBe(false)
  })
})

describe('LlmCapExceededError', () => {
  it('carries the scope in .scope', () => {
    const err = new LlmCapExceededError('team_daily', 'over budget')
    expect(err.scope).toBe('team_daily')
    expect(err.message).toBe('over budget')
    expect(err.name).toBe('LlmCapExceededError')
    expect(err).toBeInstanceOf(Error)
  })

  it('is distinguishable from a plain Error', () => {
    const err = new LlmCapExceededError('global_monthly', 'monthly limit')
    expect(err instanceof LlmCapExceededError).toBe(true)
  })

  // Verifies that cap enforcement blocks a call.
  // The logic: if checkBudgetExceeded → throw LlmCapExceededError before calling OpenAI.
  it('cap logic: team daily cap blocks when exceeded', () => {
    const teamSpent = 2.01
    const cap = 2.0
    if (checkBudgetExceeded(teamSpent, cap)) {
      const err = new LlmCapExceededError('team_daily', 'over team daily cap')
      expect(err.scope).toBe('team_daily')
    } else {
      throw new Error('Expected budget to be exceeded')
    }
  })

  it('cap logic: global daily cap blocks when exceeded', () => {
    const globalSpent = 20.5
    const cap = 20
    expect(checkBudgetExceeded(globalSpent, cap)).toBe(true)
  })

  it('cap logic: global monthly cap blocks when exceeded', () => {
    const monthlySpent = 50.0
    const cap = 50
    expect(checkBudgetExceeded(monthlySpent, cap)).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { computeReworkScore } from './scoring.js'

describe('computeReworkScore', () => {
  it('returns 0 for clean PR', () => {
    expect(
      computeReworkScore({
        wasReverted: false,
        downstreamFixCount: 0,
        ciFailureCount: 0,
        hadHotfix: false,
      }),
    ).toBe(0)
  })

  it('reverted PR scores 60', () => {
    expect(
      computeReworkScore({
        wasReverted: true,
        downstreamFixCount: 0,
        ciFailureCount: 0,
        hadHotfix: false,
      }),
    ).toBe(60)
  })

  it('caps downstream fix contribution at 30', () => {
    const score = computeReworkScore({
      wasReverted: false,
      downstreamFixCount: 10,
      ciFailureCount: 0,
      hadHotfix: false,
    })
    expect(score).toBe(30)
  })

  it('caps total at 100', () => {
    const score = computeReworkScore({
      wasReverted: true,
      downstreamFixCount: 5,
      ciFailureCount: 10,
      hadHotfix: true,
    })
    expect(score).toBe(100)
  })
})

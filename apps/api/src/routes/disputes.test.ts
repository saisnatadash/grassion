import { describe, it, expect } from 'vitest'

// ── Dispute status machine ────────────────────────────────────────────────────

type DisputeStatus = 'pending' | 'accepted' | 'rejected'

function resolveDispute(current: DisputeStatus, action: 'accept' | 'reject'): DisputeStatus {
  if (current !== 'pending') throw new Error('already_resolved')
  return action === 'accept' ? 'accepted' : 'rejected'
}

describe('dispute status machine', () => {
  it('pending → accepted on accept', () => {
    expect(resolveDispute('pending', 'accept')).toBe('accepted')
  })

  it('pending → rejected on reject', () => {
    expect(resolveDispute('pending', 'reject')).toBe('rejected')
  })

  it('throws when trying to resolve an already-accepted dispute', () => {
    expect(() => resolveDispute('accepted', 'accept')).toThrow('already_resolved')
  })

  it('throws when trying to resolve an already-rejected dispute', () => {
    expect(() => resolveDispute('rejected', 'reject')).toThrow('already_resolved')
  })
})

// ── Weight override validation ────────────────────────────────────────────────

function applyWeightOverride(
  existingWeight: number,
  action: 'accept' | 'reject',
  weightOverride: number | undefined,
): number {
  if (action !== 'accept' || typeof weightOverride !== 'number') return existingWeight
  return weightOverride
}

describe('weight override on dispute accept', () => {
  it('uses weight override of 0 (hide evidence)', () => {
    expect(applyWeightOverride(1.0, 'accept', 0)).toBe(0)
  })

  it('uses positive weight override', () => {
    expect(applyWeightOverride(1.0, 'accept', 0.5)).toBe(0.5)
  })

  it('keeps original weight when rejecting', () => {
    expect(applyWeightOverride(1.0, 'reject', 0)).toBe(1.0)
  })

  it('keeps original weight when no override provided on accept', () => {
    expect(applyWeightOverride(1.0, 'accept', undefined)).toBe(1.0)
  })
})

// ── Reason validation ─────────────────────────────────────────────────────────

describe('dispute reason validation', () => {
  function validateReason(reason: unknown): boolean {
    return typeof reason === 'string' && reason.trim().length > 0
  }

  it('accepts a non-empty reason', () => {
    expect(validateReason('This was auto-generated, not me')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(validateReason('')).toBe(false)
  })

  it('rejects whitespace-only', () => {
    expect(validateReason('   ')).toBe(false)
  })

  it('rejects non-string', () => {
    expect(validateReason(null)).toBe(false)
    expect(validateReason(undefined)).toBe(false)
  })
})

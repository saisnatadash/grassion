import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'

// ── Slack signature verification logic (unit-testable subset) ─────────────────

function buildSignature(secret: string, timestamp: string, body: string): string {
  const sigBase = `v0:${timestamp}:${body}`
  return `v0=${crypto.createHmac('sha256', secret).update(sigBase).digest('hex')}`
}

function isStale(timestamp: string): boolean {
  return Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300
}

describe('Slack signature verification', () => {
  const SECRET = 'test-signing-secret-abc123'

  it('accepts a valid fresh signature', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const body = 'command=%2Fgrassion&text=who+src%2Fauth'
    const sig = buildSignature(SECRET, ts, body)
    expect(sig.startsWith('v0=')).toBe(true)
  })

  it('rejects a stale timestamp (> 5 minutes old)', () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 400)
    expect(isStale(oldTs)).toBe(true)
  })

  it('accepts a fresh timestamp', () => {
    const freshTs = String(Math.floor(Date.now() / 1000) - 10)
    expect(isStale(freshTs)).toBe(false)
  })

  it('produces different signatures for different bodies', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const s1 = buildSignature(SECRET, ts, 'body1')
    const s2 = buildSignature(SECRET, ts, 'body2')
    expect(s1).not.toBe(s2)
  })

  it('produces different signatures for different secrets', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const s1 = buildSignature('secret1', ts, 'body')
    const s2 = buildSignature('secret2', ts, 'body')
    expect(s1).not.toBe(s2)
  })
})

describe('/grassion who command parsing', () => {
  function parseGrassionCommand(text: string): { subcommand: string; query: string } | null {
    const args = text.trim().split(/\s+/)
    const subcommand = args[0]?.toLowerCase() ?? ''
    const query = args.slice(1).join(' ')
    if (subcommand !== 'who' || !query) return null
    return { subcommand, query }
  }

  it('parses "who src/auth"', () => {
    const result = parseGrassionCommand('who src/auth')
    expect(result).toEqual({ subcommand: 'who', query: 'src/auth' })
  })

  it('returns null for missing query', () => {
    expect(parseGrassionCommand('who')).toBeNull()
    expect(parseGrassionCommand('who   ')).toBeNull()
  })

  it('returns null for unknown subcommand', () => {
    expect(parseGrassionCommand('help')).toBeNull()
    expect(parseGrassionCommand('')).toBeNull()
  })

  it('joins multi-word query', () => {
    const result = parseGrassionCommand('who payment service')
    expect(result?.query).toBe('payment service')
  })
})

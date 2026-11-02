import { describe, it, expect } from 'vitest'
import { darkCodeDigestSubject, darkCodeDigestText, darkCodeDigestHtml, type DarkCodeDigestData } from './dark-code-digest.js'

const base: DarkCodeDigestData = {
  teamName: 'ACME',
  darkPct: 25,
  prevDarkPct: 20,
  totalAreas: 20,
  darkAreas: 5,
  criticalDarkAreas: 1,
  singlePersonAreas: 3,
  newFragileAreas: [{ path: 'src/auth', isCritical: true }],
  lostCoverageAreas: [{ path: 'src/billing', lastPerson: 'alice' }],
  appUrl: 'https://app.grassion.com',
}

describe('darkCodeDigestSubject', () => {
  it('includes the dark percentage', () => {
    expect(darkCodeDigestSubject(base)).toContain('25%')
  })

  it('shows ↑ trend when dark% increased', () => {
    expect(darkCodeDigestSubject(base)).toContain('↑')
  })

  it('shows ↓ trend when dark% decreased', () => {
    const data = { ...base, darkPct: 15, prevDarkPct: 20 }
    expect(darkCodeDigestSubject(data)).toContain('↓')
  })

  it('omits trend arrow when no previous data', () => {
    const data = { ...base, prevDarkPct: null }
    expect(darkCodeDigestSubject(data)).not.toContain('↑')
    expect(darkCodeDigestSubject(data)).not.toContain('↓')
  })
})

describe('darkCodeDigestText', () => {
  it('includes team name', () => {
    expect(darkCodeDigestText(base)).toContain('ACME')
  })

  it('includes dark area count', () => {
    expect(darkCodeDigestText(base)).toContain('5/20')
  })

  it('lists new fragile areas', () => {
    expect(darkCodeDigestText(base)).toContain('src/auth')
    expect(darkCodeDigestText(base)).toContain('CRITICAL')
  })

  it('lists lost coverage areas', () => {
    expect(darkCodeDigestText(base)).toContain('src/billing')
    expect(darkCodeDigestText(base)).toContain('@alice')
  })

  it('includes report link', () => {
    expect(darkCodeDigestText(base)).toContain('https://app.grassion.com/dark-code')
  })
})

describe('darkCodeDigestHtml', () => {
  it('returns valid HTML string', () => {
    const html = darkCodeDigestHtml(base)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('25%')
  })

  it('shows critical dark areas in red', () => {
    const html = darkCodeDigestHtml(base)
    expect(html).toContain('src/auth')
  })

  it('handles zero fragile and lost areas gracefully', () => {
    const data = { ...base, newFragileAreas: [], lostCoverageAreas: [] }
    const html = darkCodeDigestHtml(data)
    expect(html).toContain('<!DOCTYPE html>')
  })
})

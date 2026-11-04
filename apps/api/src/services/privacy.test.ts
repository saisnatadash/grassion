/**
 * Privacy invariant tests — CLAUDE.md hard rule:
 * "never read, store, or send source code or diff patches."
 * "From the GitHub 'list pull request files' API, store only filename, status,
 *  additions, deletions. Ignore and never persist the patch field."
 *
 * These tests fail CI if any change accidentally exposes patch/diff data.
 */

import { describe, it, expect } from 'vitest'
import { sanitizeFile } from '../jobs/backfillCoverage.helpers.js'

describe('sanitizeFile strips patch and all non-allow-listed fields', () => {
  it('passes through the four allowed fields', () => {
    const result = sanitizeFile({
      filename: 'src/foo.ts',
      status: 'modified',
      additions: 10,
      deletions: 3,
    })
    expect(result).toEqual({ filename: 'src/foo.ts', status: 'modified', additions: 10, deletions: 3 })
  })

  it('drops the patch field — never stored', () => {
    const result = sanitizeFile({
      filename: 'src/foo.ts',
      status: 'modified',
      additions: 5,
      deletions: 2,
      patch: '@@ -1,3 +1,4 @@\n+const x = secret_key',
    } as Parameters<typeof sanitizeFile>[0] & { patch: string })
    expect(result).not.toHaveProperty('patch')
    // Confirm no leaked value
    const values = Object.values(result)
    expect(values.some((v) => typeof v === 'string' && v.includes('secret_key'))).toBe(false)
  })

  it('drops blob_url, raw_url, contents_url if present', () => {
    const result = sanitizeFile({
      filename: 'src/bar.ts',
      status: 'added',
      additions: 1,
      deletions: 0,
      blob_url: 'https://github.com/blob/abc',
      raw_url: 'https://raw.githubusercontent.com/abc',
      contents_url: 'https://api.github.com/repos/owner/repo/contents/bar.ts?ref=abc',
    } as Parameters<typeof sanitizeFile>[0] & { blob_url: string; raw_url: string; contents_url: string })
    expect(result).not.toHaveProperty('blob_url')
    expect(result).not.toHaveProperty('raw_url')
    expect(result).not.toHaveProperty('contents_url')
    expect(Object.keys(result)).toEqual(['filename', 'status', 'additions', 'deletions'])
  })

  it('output has exactly the four allowed keys and nothing else', () => {
    const input = {
      filename: 'x.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      patch: 'secret diff',
      sha: 'abc123',
      extra: 'should not appear',
    }
    const result = sanitizeFile(input as Parameters<typeof sanitizeFile>[0] & { patch: string; sha: string; extra: string })
    expect(Object.keys(result).sort()).toEqual(['additions', 'deletions', 'filename', 'status'])
  })
})

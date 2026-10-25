import type { Octokit } from '@octokit/rest'
import { logger } from '../../logger.js'
import type { PrSummary } from './labeling.js'

const PAGE_SIZE = 100
// 18 months of history
const LOOKBACK_MONTHS = 18

export function sinceDate(): Date {
  const d = new Date()
  d.setMonth(d.getMonth() - LOOKBACK_MONTHS)
  return d
}

type FetchResult = {
  prs: PrSummary[]
  nextPage: number | null
}

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function withRateLimit<T>(octokit: Octokit, fn: () => Promise<T>): Promise<T> {
  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      if ((status === 403 || status === 429) && attempt < 3) {
        const backoff = Math.pow(2, attempt) * 15_000
        logger.warn({ status, attempt, backoffMs: backoff }, 'rfg: rate limited, backing off')
        await sleep(backoff)
        attempt++
        continue
      }
      throw err
    }
  }
}

export async function fetchPrPage(
  octokit: Octokit,
  owner: string,
  repo: string,
  page: number,
  since: Date,
): Promise<FetchResult> {
  const res = await withRateLimit(octokit, () =>
    octokit.pulls.list({
      owner,
      repo,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: PAGE_SIZE,
      page,
    }),
  )

  const headers = res.headers as Record<string, string>
  const remaining = Number(headers['x-ratelimit-remaining'] ?? 999)
  if (remaining < 10) {
    const resetAt = Number(headers['x-ratelimit-reset'] ?? 0) * 1000
    const waitMs = Math.max(resetAt - Date.now(), 5000)
    logger.warn({ remaining, waitMs }, 'rfg: near rate limit, sleeping')
    await sleep(waitMs)
  }

  const prs: PrSummary[] = []
  let reachedSince = false

  for (const pr of res.data) {
    if (!pr.merged_at) continue

    const mergedAt = new Date(pr.merged_at)
    if (mergedAt < since) {
      reachedSince = true
      break
    }

    prs.push({
      number: pr.number,
      title: pr.title,
      body: pr.body ?? null,
      mergedAt: pr.merged_at,
      headRefName: pr.head.ref,
      labels: pr.labels.map((l) => l.name ?? ''),
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      authorLogin: pr.user?.login ?? null,
      files: [],
    })
  }

  const isDone = res.data.length < PAGE_SIZE || reachedSince
  return { prs, nextPage: isDone ? null : page + 1 }
}

export async function fetchPrDetails(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ additions: number; deletions: number; changedFiles: number; files: PrSummary['files'] }> {
  const [detailRes, filesRes] = await Promise.all([
    withRateLimit(octokit, () =>
      octokit.pulls.get({ owner, repo, pull_number: prNumber }),
    ),
    withRateLimit(octokit, () =>
      octokit.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100 }),
    ),
  ])

  return {
    additions: detailRes.data.additions,
    deletions: detailRes.data.deletions,
    changedFiles: detailRes.data.changed_files,
    files: filesRes.data.map((f) => ({
      filename: f.filename,
      additions: f.additions,
      deletions: f.deletions,
    })),
  }
}

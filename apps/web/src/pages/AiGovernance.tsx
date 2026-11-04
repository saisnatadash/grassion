import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { downloadCsv } from '../lib/csv.js'

const MONTH_OPTIONS = [1, 3, 6, 12]

function CoverageBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? 'bg-emerald-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[#1e1e1e] rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-[#888] w-8 text-right">{pct}%</span>
    </div>
  )
}

export function AiGovernancePage() {
  const [months, setMonths] = useState(3)

  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-governance', months],
    queryFn: () => api.hc.aiGovernance(months),
    staleTime: 5 * 60_000,
  })

  if (isLoading) return <div className="p-8 text-[#555] text-sm">Loading audit log…</div>
  if (error) {
    const e = error as { status?: number }
    if (e.status === 403) {
      return (
        <div className="max-w-2xl mx-auto py-24 px-6 text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-xl font-light text-white mb-2">Business or Enterprise plan required</h2>
          <p className="text-sm text-[#555] mb-6">The AI Governance Audit provides a documented, auditable record that every AI-assisted commit received qualified human review. Required for SOC2, ISO 27001, and AI risk governance frameworks.</p>
          <a href="/billing" className="inline-block px-5 py-2.5 bg-white text-black text-xs font-mono uppercase tracking-widest rounded hover:opacity-85 transition-opacity">Upgrade plan</a>
        </div>
      )
    }
    return <div className="p-8 text-red-400 text-sm">Failed to load audit log.</div>
  }
  if (!data) return null

  const { summary, entries, period } = data

  const CSV_COLS = ['pr_number', 'repo', 'title', 'author', 'ai_tool', 'merged_at', 'reviewers', 'has_qualified_review', 'avg_reviewer_weight']

  function handleExportCsv() {
    if (!data) return
    const rows = data.entries.map((e) => ({
      pr_number: e.prNumber,
      repo: e.repoName,
      title: e.title,
      author: e.authorLogin,
      ai_tool: e.aiSource,
      merged_at: e.mergedAt,
      reviewers: e.reviewers.join('; '),
      has_qualified_review: e.hasQualifiedReview ? 'YES' : 'NO',
      avg_reviewer_weight: e.avgReviewerWeight,
    }))
    downloadCsv(rows, CSV_COLS, `grassion-ai-governance-${months}mo.csv`)
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[#555] block mb-2">AI Governance Audit</span>
          <h1 className="text-2xl font-light text-white">Human review of AI-assisted code</h1>
          <p className="text-sm text-[#444] mt-1">
            {new Date(period.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {' — '}
            {new Date(period.to).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex border border-[#222] rounded overflow-hidden">
            {MONTH_OPTIONS.map((m) => (
              <button
                key={m}
                onClick={() => setMonths(m)}
                className={cn(
                  'px-3 py-1.5 text-[11px] font-mono transition-colors',
                  months === m ? 'bg-white text-black' : 'text-[#666] hover:text-white',
                )}
              >
                {m}mo
              </button>
            ))}
          </div>
          <button
            onClick={handleExportCsv}
            className="px-4 py-2 border border-[#2a2a2a] text-xs font-mono text-[#888] hover:text-white hover:border-[#444] transition-colors rounded"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        <div className="p-5 border border-[#1e1e1e] rounded-lg bg-[#111]">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[#555] block mb-1">AI-assisted PRs</span>
          <span className="text-3xl font-light text-white">{summary.totalAiPrs}</span>
        </div>
        <div className="p-5 border border-[#1e1e1e] rounded-lg bg-[#111]">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[#555] block mb-1">With qualified review</span>
          <span className={cn('text-3xl font-light', summary.coveredPct >= 90 ? 'text-emerald-400' : summary.coveredPct >= 70 ? 'text-yellow-400' : 'text-red-400')}>
            {summary.coveredPct}%
          </span>
        </div>
        <div className="p-5 border border-[#1e1e1e] rounded-lg bg-[#111]">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[#555] block mb-1">Unreviewed</span>
          <span className={cn('text-3xl font-light', summary.uncoveredCount > 0 ? 'text-red-400' : 'text-white')}>
            {summary.uncoveredCount}
          </span>
        </div>
        <div className="p-5 border border-[#1e1e1e] rounded-lg bg-[#111]">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[#555] block mb-1">Avg reviewer weight</span>
          <span className="text-3xl font-light text-white">{summary.avgReviewerWeight.toFixed(2)}</span>
          <span className="text-[11px] text-[#444]">coverage confidence</span>
        </div>
      </div>

      {/* Coverage bar */}
      <div className="mb-8 p-4 border border-[#1e1e1e] rounded-lg bg-[#111]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-[#555]">Review coverage</span>
          <span className="text-xs font-mono text-[#555]">{summary.coveredCount} / {summary.totalAiPrs} AI PRs had a qualified human reviewer</span>
        </div>
        <CoverageBar pct={summary.coveredPct} />
      </div>

      {/* Entries table */}
      {entries.length === 0 ? (
        <div className="py-16 text-center text-[#444] text-sm">No AI-assisted PRs found in this period.</div>
      ) : (
        <div className="border border-[#1e1e1e] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e1e1e] bg-[#111]">
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">PR</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">Title</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">AI tool</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">Merged</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">Reviewers</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">Review</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`${e.repoName}#${e.prNumber}`} className="border-b border-[#141414] last:border-0 hover:bg-white/2">
                  <td className="px-4 py-2.5 font-mono text-xs text-[#666]">
                    <span className="text-[#444]">{e.repoName}</span>
                    <span className="text-[#555]"> #{e.prNumber}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[#ccc] max-w-xs truncate">{e.title}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-[#777]">{e.aiSource}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-[#555]">
                    {e.mergedAt ? new Date(e.mergedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-[#666]">
                    {e.reviewers.length > 0 ? e.reviewers.map((r) => `@${r}`).join(', ') : <span className="text-[#333]">none</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {e.hasQualifiedReview
                      ? <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 rounded">✓ REVIEWED</span>
                      : <span className="inline-flex items-center gap-1 text-[10px] font-mono text-red-400 border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 rounded">✗ UNREVIEWED</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

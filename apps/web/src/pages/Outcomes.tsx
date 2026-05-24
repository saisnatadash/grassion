import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RotateCcw, Zap, AlertTriangle, Clock, ChevronRight } from 'lucide-react'
import { api, type PrOutcomeItem } from '../lib/api.js'
import { cn } from '../lib/utils.js'

type Filter = 'all' | 'reverted' | 'hotfix' | 'problem'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'reverted', label: 'Reverted' },
  { id: 'hotfix', label: 'Hotfixed' },
  { id: 'problem', label: 'High Risk' },
]

function scoreColor(score: number) {
  if (score >= 60) return 'text-red-400'
  if (score >= 30) return 'text-yellow-400'
  return 'text-green-400'
}

function scoreBg(score: number) {
  if (score >= 60) return 'bg-red-500/15 border-red-500/20'
  if (score >= 30) return 'bg-yellow-500/15 border-yellow-500/20'
  return 'bg-green-500/15 border-green-500/20'
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function OutcomeRow({ item }: { item: PrOutcomeItem }) {
  const [expanded, setExpanded] = useState(false)
  const score = item.reworkScore ?? 0

  return (
    <div className="border border-[#222] rounded-xl bg-[#111] overflow-hidden">
      <button
        onClick={() => setExpanded((o) => !o)}
        className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-white/3 transition-colors"
      >
        {/* Score badge */}
        <div
          className={cn(
            'flex-shrink-0 mt-0.5 flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-bold',
            scoreBg(score),
            scoreColor(score),
          )}
        >
          {Math.round(score)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">
              #{item.prNumber}
            </span>
            <span className="text-sm text-[#aaa] truncate max-w-xs">{item.prTitle}</span>
            {item.aiSource && (
              <span className="ml-auto flex-shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-medium text-[#888] uppercase tracking-wide">
                {item.aiSource}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs text-[#555]">
            {item.authorLogin && <span>@{item.authorLogin}</span>}
            <span>{timeAgo(item.mergedAt)}</span>
            {item.wasReverted && (
              <span className="flex items-center gap-1 text-red-400">
                <RotateCcw className="h-3 w-3" /> reverted
              </span>
            )}
            {item.hadHotfixWithin7d && (
              <span className="flex items-center gap-1 text-orange-400">
                <Zap className="h-3 w-3" /> hotfix
              </span>
            )}
            {(item.ciFailureCount ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-yellow-400">
                <AlertTriangle className="h-3 w-3" /> {item.ciFailureCount} CI {item.ciFailureCount === 1 ? 'failure' : 'failures'}
              </span>
            )}
            {(item.downstreamFixCount ?? 0) > 0 && (
              <span className="text-[#666]">{item.downstreamFixCount} downstream fix{item.downstreamFixCount === 1 ? '' : 'es'}</span>
            )}
          </div>
        </div>

        <ChevronRight
          className={cn('h-4 w-4 flex-shrink-0 text-[#444] transition-transform mt-3', expanded && 'rotate-90')}
        />
      </button>

      {expanded && (
        <div className="border-t border-[#1a1a1a] px-5 py-4 space-y-3">
          {item.aiSummary ? (
            <div className="rounded-lg bg-[#0d0d0d] border border-[#222] px-4 py-3">
              <p className="text-xs font-semibold text-[#555] uppercase tracking-wider mb-1.5">AI Analysis</p>
              <p className="text-sm text-[#aaa] leading-relaxed">{item.aiSummary}</p>
            </div>
          ) : (
            <div className="rounded-lg bg-[#0d0d0d] border border-[#222] px-4 py-3">
              <p className="text-xs font-semibold text-[#555] uppercase tracking-wider mb-1.5">AI Analysis</p>
              <p className="text-sm text-[#555] italic">
                {score >= 30 ? 'Summary will be generated on the next worker run.' : 'No analysis needed — low rework risk.'}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Rework Score', value: `${Math.round(score)}/100` },
              { label: 'CI Failures', value: String(item.ciFailureCount ?? 0) },
              { label: 'Downstream Fixes', value: String(item.downstreamFixCount ?? 0) },
              { label: 'Computed', value: timeAgo(item.computedAt) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg bg-[#0d0d0d] border border-[#1a1a1a] px-3 py-2.5">
                <div className="text-[10px] text-[#555] uppercase tracking-wider">{label}</div>
                <div className="mt-0.5 text-sm font-semibold text-white">{value}</div>
              </div>
            ))}
          </div>
          {item.revertPrNumber && (
            <p className="text-xs text-[#555]">
              Reverted by PR #{item.revertPrNumber}
              {item.revertedAt ? ` on ${new Date(item.revertedAt).toLocaleDateString()}` : ''}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function OutcomesPage() {
  const [filter, setFilter] = useState<Filter>('all')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', 'pr-outcomes', filter],
    queryFn: () => api.analytics.prOutcomes(filter),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const items = data ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Post-Merge Outcomes</h1>
        <p className="mt-1 text-sm text-[#555]">
          Track what happened after merge: reverts, hotfixes, CI failures, and rework signals.
          Outcomes are computed 7 days after merge.
        </p>
      </div>

      {/* Filter strip */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              filter === id
                ? 'bg-white text-[#0a0a0a]'
                : 'border border-[#222] bg-[#111] text-[#888] hover:text-white',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#333] border-t-white" />
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-[#222] bg-[#111] p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-[#444] mb-3" />
          <p className="text-[#666] text-sm">Could not load outcomes. Try again later.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-[#222] bg-[#111] p-12 text-center">
          <Clock className="mx-auto h-10 w-10 text-[#333] mb-4" />
          <h2 className="text-base font-semibold text-white mb-1">No outcomes yet</h2>
          <p className="text-sm text-[#555] max-w-sm mx-auto">
            {filter === 'all'
              ? 'Outcome data is computed 7 days after a PR merges. Check back once your team has merged some AI-assisted PRs.'
              : `No ${filter === 'reverted' ? 'reverted' : filter === 'hotfix' ? 'hotfixed' : 'high-risk'} PRs found.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-[#555]">
            Showing {items.length} result{items.length === 1 ? '' : 's'}, sorted by rework score.
          </p>
          {items.map((item) => (
            <OutcomeRow key={item.prId} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, User, Users, Shield, EyeOff, Moon, Flame, RefreshCw } from 'lucide-react'
import { api } from '../lib/api.js'
import { type DarkCodeReportData } from './DarkCodeReport.js'
import { cn } from '../lib/utils.js'
import { Spinner, Badge, Card, CardContent, CardHeader, CardTitle } from '../components/ui.js'

type Tab = 'dark' | 'fragile' | 'single'

export function RiskMapPage() {
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })
  const repoId = searchParams.get('repo') ?? repos.data?.[0]?.id ?? ''

  const report = useQuery({
    queryKey: ['hc-report', repoId],
    queryFn: () => api.hc.report(repoId),
    enabled: !!repoId,
    staleTime: 5 * 60 * 1000,
  })

  const backfillStatus = useQuery({
    queryKey: ['backfill-status', repoId],
    queryFn: () => api.hc.backfillStatus(repoId),
    enabled: !!repoId,
    refetchInterval: (q) => q.state.data?.status === 'running' ? 3_000 : false,
  })

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.repos.sync(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['backfill-status', repoId] })
    },
  })

  // Refresh report once backfill completes
  const prevStatus = useRef<string | undefined>()
  useEffect(() => {
    const s = backfillStatus.data?.status
    if (prevStatus.current === 'running' && s === 'complete') {
      void qc.invalidateQueries({ queryKey: ['hc-report', repoId] })
    }
    prevStatus.current = s
  }, [backfillStatus.data?.status, repoId, qc])

  // Auto-trigger backfill if no data and no run has started
  const autoTriggered = useRef(false)
  useEffect(() => {
    if (!repoId || autoTriggered.current) return
    if (!backfillStatus.isFetched) return
    if (backfillStatus.data?.status !== 'none') return
    if (report.data?.headline.totalAreas) return
    autoTriggered.current = true
    syncMutation.mutate(repoId)
  }, [repoId, backfillStatus.isFetched, backfillStatus.data?.status, report.data, syncMutation])

  const [tab, setTab] = useState<Tab>('dark')

  const isRunning = backfillStatus.data?.status === 'running' || syncMutation.isPending

  if (repos.isLoading) {
    return <div className="flex justify-center p-12"><Spinner /></div>
  }
  if (!repoId) {
    return (
      <div className="text-center py-16 text-[#666]">
        <Shield className="mx-auto mb-4 w-10 h-10 opacity-30" />
        <p>Connect a repo to view the risk map.</p>
      </div>
    )
  }

  const data = report.data as DarkCodeReportData | undefined
  const headline = data?.headline
  const fragileAndDark = data?.fragileAndDark ?? []
  const singlePersonAreas = data?.singlePersonAreas ?? []

  const TABS: { id: Tab; label: string; count: number }[] = [
    { id: 'dark', label: 'Dark areas', count: headline?.darkAreas ?? 0 },
    { id: 'fragile', label: 'Fragile & risky', count: fragileAndDark.length },
    { id: 'single', label: 'Single-reviewer', count: singlePersonAreas.length },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <EyeOff className="w-6 h-6 text-purple-400" />
            Risk Map
          </h1>
          <p className="mt-1 text-sm text-[#888]">
            Code areas with no human reviewer, risky AI-only changes, and fragile single-owner paths
            {data?.repo ? ` · ${data.repo.owner}/${data.repo.name}` : ''}
          </p>
          {isRunning && (
            <p className="mt-1.5 text-xs text-purple-400 flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin" />
              {backfillStatus.data?.statusDetail ?? 'Scanning PR history…'}
              {backfillStatus.data?.progressPct != null && ` (${backfillStatus.data.progressPct}%)`}
            </p>
          )}
          {backfillStatus.data?.status === 'failed' && (
            <p className="mt-1.5 text-xs text-red-400">{backfillStatus.data.error ?? 'Backfill failed'}</p>
          )}
        </div>
        <button
          onClick={() => syncMutation.mutate(repoId)}
          disabled={isRunning}
          className="flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-1.5 text-sm text-[#888] hover:border-[#555] hover:text-white transition-colors disabled:opacity-40 flex-shrink-0"
          title="Re-scan PR history to rebuild coverage data"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isRunning && 'animate-spin')} />
          {isRunning ? 'Scanning…' : 'Re-sync'}
        </button>
      </div>

      {/* Headline stats */}
      {headline && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-[#222] bg-[#111] p-4">
            <div className="text-xs text-[#555] uppercase tracking-widest mb-2">Total areas</div>
            <div className="text-2xl font-bold text-white">{headline.totalAreas}</div>
          </div>
          <div className={cn(
            'rounded-xl border p-4',
            headline.darkPct > 30 ? 'border-red-800/40 bg-red-950/10' : 'border-[#222] bg-[#111]',
          )}>
            <div className="text-xs text-[#555] uppercase tracking-widest mb-2">Dark areas</div>
            <div className={cn('text-2xl font-bold', headline.darkPct > 30 ? 'text-red-400' : 'text-white')}>
              {headline.darkAreas}
              <span className="text-sm text-[#555] font-normal ml-1">{headline.darkPct}%</span>
            </div>
          </div>
          <div className="rounded-xl border border-[#222] bg-[#111] p-4">
            <div className="text-xs text-[#555] uppercase tracking-widest mb-2">At-risk paths</div>
            <div className="text-2xl font-bold text-white">{singlePersonAreas.length}</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#222]">
        {TABS.map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === id
                ? 'border-white text-white'
                : 'border-transparent text-[#666] hover:text-[#aaa]',
            )}
          >
            {label}
            {count > 0 && (
              <span className={cn(
                'inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-bold min-w-[18px]',
                tab === id ? 'bg-white/15 text-white' : 'bg-white/5 text-[#666]',
              )}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Dark areas */}
      {tab === 'dark' && (
        <DarkAreasTab data={data} />
      )}

      {/* Tab: Fragile & risky */}
      {tab === 'fragile' && (
        <FragileTab fragileAndDark={fragileAndDark} />
      )}

      {/* Tab: Single-reviewer */}
      {tab === 'single' && (
        <SingleTab singlePersonAreas={singlePersonAreas} />
      )}
    </div>
  )
}

// ── Dark areas tab ────────────────────────────────────────────────────────────

function DarkAreasTab({ data }: { data: DarkCodeReportData | undefined }) {
  const darkByMonth = data?.darkByMonth ?? []
  if (!data || (data.headline.darkAreas === 0 && darkByMonth.length === 0)) {
    return <EmptyState icon={<EyeOff />} text="No dark areas detected." />
  }

  const trend = data.headline.trend ?? []

  return (
    <div className="space-y-4">
      {data.headline.darkAreas > 0 && (
        <div className="rounded-xl border border-red-800/30 bg-red-950/10 px-4 py-3">
          <p className="text-sm text-red-200">
            <AlertTriangle className="inline h-3.5 w-3.5 mr-1.5" />
            <strong>{data.headline.darkAreas}</strong> area{data.headline.darkAreas !== 1 ? 's' : ''} ({data.headline.darkPct}%) have never been reviewed by a human.
            These carry the highest compliance risk.
          </p>
        </div>
      )}

      {trend.length > 0 && (
        <div className="rounded-xl border border-[#222] bg-[#111] p-4">
          <p className="text-xs text-[#555] uppercase tracking-widest mb-3">12-month coverage trend</p>
          <div className="space-y-2">
            {trend.map((t) => (
              <div key={t.month} className="grid grid-cols-[64px_1fr_1fr_60px_60px] gap-3 items-center text-xs">
                <span className="text-[#555]">{t.month}</span>
                <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${t.aiRisk}%` }} />
                </div>
                <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                  <div className="h-full rounded-full bg-green-500" style={{ width: `${t.humanCoverage}%` }} />
                </div>
                <span className="text-blue-400 text-right">{t.aiRisk}% AI</span>
                <span className="text-green-400 text-right">{t.humanCoverage}% cov</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Fragile & risky tab ───────────────────────────────────────────────────────

function FragileTab({ fragileAndDark }: { fragileAndDark: DarkCodeReportData['fragileAndDark'] }) {
  if (fragileAndDark.length === 0) {
    return <EmptyState icon={<Flame />} text="No fragile or risky AI-only areas detected." />
  }
  return (
    <div className="space-y-3">
      {fragileAndDark.map(({ failure, areas }) => (
        <Card key={failure.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
              <span className="text-white">PR #{failure.originalPr ?? '?'}</span>
              <Badge className={cn(
                'text-[10px]',
                failure.state === 'confirmed'
                  ? 'bg-red-900/40 text-red-300 border-red-700/50'
                  : failure.state === 'candidate'
                  ? 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50'
                  : 'bg-[#2a2a2a] text-[#888] border-[#333]',
              )}>
                {failure.state}
              </Badge>
              {failure.revertPr && (
                <span className="text-xs text-[#555]">reverted by #{failure.revertPr}</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {areas.length > 0 && (
              <div className="space-y-1">
                {areas.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs text-[#888]">
                    {a.isCritical && <Moon className="h-3 w-3 text-red-400 flex-shrink-0" />}
                    <code className="font-mono text-[#aaa]">{a.path}</code>
                    {a.isCritical && <Badge className="bg-red-900/30 text-red-400 border-red-700/30 text-[10px]">critical</Badge>}
                  </div>
                ))}
              </div>
            )}
            {failure.testNames.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {failure.testNames.map((t) => (
                  <code key={t} className="text-[10px] bg-[#1a1a1a] rounded px-1.5 py-0.5 text-[#777] font-mono">{t}</code>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ── Single-reviewer tab ───────────────────────────────────────────────────────

function SingleTab({
  singlePersonAreas,
}: {
  singlePersonAreas: DarkCodeReportData['singlePersonAreas']
}) {
  if (singlePersonAreas.length === 0) {
    return <EmptyState icon={<Users />} text="No single-reviewer areas found." />
  }
  return (
    <div className="space-y-6">
      {singlePersonAreas.length > 0 && (
        <div>
          <h3 className="text-xs text-[#555] uppercase tracking-widest mb-3 flex items-center gap-2">
            <User className="h-3.5 w-3.5 text-yellow-400" /> Single-reviewer areas
          </h3>
          <div className="rounded-xl border border-[#222] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#141414] text-[#555] text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Path</th>
                  <th className="text-left px-4 py-3">Reviewer</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">Critical</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1a1a1a]">
                {singlePersonAreas.map((a) => (
                  <tr key={a.areaId}>
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono text-[#aaa]">{a.path}</code>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-[#888]">
                        <User className="h-3.5 w-3.5" />
                        @{a.person.githubLogin}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {a.isCritical && <Badge className="bg-red-900/30 text-red-400 border-red-700/30 text-[10px]">critical</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="text-center py-16 text-[#666]">
      <div className="mx-auto mb-4 w-10 h-10 opacity-30 flex items-center justify-center">{icon}</div>
      <p>{text}</p>
    </div>
  )
}

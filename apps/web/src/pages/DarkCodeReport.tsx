import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, User, Download, Share2, CheckCircle, XCircle,
  ExternalLink, EyeOff, Moon, Users, TrendingDown, Copy, Check,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { Spinner, Badge } from '../components/ui.js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FailureRow {
  id: string
  originalPr: number | null
  revertPr: number | null
  fixPr: number | null
  testNames: string[]
  state: 'candidate' | 'confirmed' | 'obsolete'
}

interface AreaRow {
  id: string
  path: string
  isCritical: boolean
}

interface TrendPoint {
  month: string
  aiRisk: number
  humanCoverage: number
}

export interface DarkCodeReportData {
  repo: { id: string; owner: string; name: string }
  headline: {
    totalAreas: number
    darkAreas: number
    darkPct: number
    trend: TrendPoint[]
  }
  fragileAndDark: Array<{ failure: FailureRow; areas: AreaRow[] }>
  singlePersonAreas: Array<{
    areaId: string
    path: string
    isCritical: boolean
    lastChangedAt: string | null
    person: { githubLogin: string }
  }>
  darkByMonth: Array<{ month: string; ai: number; other: number }>
  offboarding: Array<{
    areaId: string
    path: string
    isCritical: boolean
    lastPerson: { githubLogin: string; leftAt: string | null }
  }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || 'https://grassion-api.fly.dev'

function prLink(owner: string, name: string, num: number) {
  return `https://github.com/${owner}/${name}/pull/${num}`
}

function fmtMonth(iso: string) {
  const [y, m] = iso.split('-') as [string, string]
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
  })
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const d = Math.floor(ms / 86_400_000)
  if (d === 0) return 'today'
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// ── Section components ────────────────────────────────────────────────────────

function SectionHeader({ icon, title, count, color = 'text-white' }: {
  icon: React.ReactNode
  title: string
  count?: number
  color?: string
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className={cn('flex-shrink-0', color)}>{icon}</span>
      <h2 className={cn('text-sm font-semibold', color)}>{title}</h2>
      {count !== undefined && (
        <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-[#1a1a1a] text-[#888] border border-[#222]">
          {count}
        </span>
      )}
    </div>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-[#222222] bg-[#111111] p-5', className)}>
      {children}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-sm text-[#555] py-6 text-center">{message}</p>
  )
}

// ── Fragile & Dark section ────────────────────────────────────────────────────

function FragileAndDark({
  rows,
  repoOwner,
  repoName,
  onVerdict,
  readOnly,
}: {
  rows: DarkCodeReportData['fragileAndDark']
  repoOwner: string
  repoName: string
  onVerdict: (failureId: string, verdict: 'confirmed' | 'dismissed') => void
  readOnly: boolean
}) {
  return (
    <Card>
      <SectionHeader
        icon={<AlertTriangle className="h-4 w-4" />}
        title="Fragile & Dark"
        count={rows.length}
        color="text-red-400"
      />
      {rows.length === 0 ? (
        <EmptyState message="No fragile dark areas detected." />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(({ failure, areas }) => (
            <div
              key={failure.id}
              data-testid="fragile-row"
              className="rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] p-4 flex flex-col gap-2"
            >
              {/* Areas */}
              <div className="flex flex-wrap gap-1.5">
                {areas.map((a) => (
                  <span
                    key={a.id}
                    className={cn(
                      'font-mono text-xs px-2 py-0.5 rounded border',
                      a.isCritical
                        ? 'border-red-900/50 bg-red-950/30 text-red-300'
                        : 'border-[#333] bg-[#1a1a1a] text-[#bbb]',
                    )}
                  >
                    {a.path}
                    {a.isCritical && (
                      <span className="ml-1 text-[10px] text-red-400">critical</span>
                    )}
                  </span>
                ))}
              </div>

              {/* PR links */}
              <div className="flex flex-wrap gap-3 text-xs">
                {failure.originalPr && (
                  <a
                    href={prLink(repoOwner, repoName, failure.originalPr)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[#888] hover:text-white transition-colors"
                    data-testid="original-pr-link"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Original #{failure.originalPr}
                  </a>
                )}
                {failure.revertPr && (
                  <a
                    href={prLink(repoOwner, repoName, failure.revertPr)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Reverted #{failure.revertPr}
                  </a>
                )}
                {failure.fixPr && (
                  <a
                    href={prLink(repoOwner, repoName, failure.fixPr)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-green-400 hover:text-green-300 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Fix #{failure.fixPr}
                  </a>
                )}
              </div>

              {/* Test names */}
              {failure.testNames.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {failure.testNames.map((t) => (
                    <span
                      key={t}
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#222] text-[#aaa] border border-[#333]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {/* Verdict buttons */}
              {!readOnly && failure.state === 'candidate' && (
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={() => onVerdict(failure.id, 'confirmed')}
                    data-testid="confirm-btn"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-green-900/40 bg-green-950/20 text-green-400 hover:bg-green-950/40 transition-colors"
                  >
                    <CheckCircle className="h-3 w-3" />
                    Confirm failure
                  </button>
                  <button
                    onClick={() => onVerdict(failure.id, 'dismissed')}
                    data-testid="dismiss-btn"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#333] bg-[#1a1a1a] text-[#888] hover:text-white hover:border-[#555] transition-colors"
                  >
                    <XCircle className="h-3 w-3" />
                    Not a real failure
                  </button>
                </div>
              )}
              {failure.state === 'confirmed' && (
                <span className="text-xs text-green-500 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" /> Confirmed failure
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Single-person areas ───────────────────────────────────────────────────────

function SinglePersonAreas({
  rows,
}: {
  rows: DarkCodeReportData['singlePersonAreas']
}) {
  return (
    <Card>
      <SectionHeader
        icon={<User className="h-4 w-4" />}
        title="Single-Person Areas"
        count={rows.length}
        color="text-yellow-400"
      />
      {rows.length === 0 ? (
        <EmptyState message="No single-person coverage areas." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="single-person-table">
            <thead>
              <tr className="text-left text-[#555] text-xs border-b border-[#222]">
                <th className="pb-2 font-medium">Area</th>
                <th className="pb-2 font-medium">Covered by</th>
                <th className="pb-2 font-medium text-right">Last changed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1a1a]">
              {rows.map((row) => (
                <tr key={row.areaId} className="hover:bg-white/2 transition-colors">
                  <td className="py-2.5 pr-4">
                    <span
                      className={cn(
                        'font-mono text-xs',
                        row.isCritical ? 'text-red-300' : 'text-[#ccc]',
                      )}
                    >
                      {row.path}
                    </span>
                    {row.isCritical && (
                      <Badge tone="red" className="ml-2 text-[10px] py-0 px-1">
                        critical
                      </Badge>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="flex items-center gap-1.5 text-[#aaa]">
                      <User className="h-3 w-3 text-[#555]" />
                      {row.person.githubLogin}
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-[#555] text-xs">
                    {row.lastChangedAt ? timeAgo(row.lastChangedAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ── Offboarding view ──────────────────────────────────────────────────────────

function OffboardingView({ rows }: { rows: DarkCodeReportData['offboarding'] }) {
  return (
    <Card>
      <SectionHeader
        icon={<Users className="h-4 w-4" />}
        title="Offboarding Risk"
        count={rows.length}
        color="text-orange-400"
      />
      {rows.length === 0 ? (
        <EmptyState message="No areas with offboarding risk." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="offboarding-table">
            <thead>
              <tr className="text-left text-[#555] text-xs border-b border-[#222]">
                <th className="pb-2 font-medium">Area</th>
                <th className="pb-2 font-medium">Last covered by</th>
                <th className="pb-2 font-medium text-right">Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1a1a]">
              {rows.map((row) => (
                <tr key={row.areaId} className="hover:bg-white/2 transition-colors">
                  <td className="py-2.5 pr-4">
                    <span
                      className={cn(
                        'font-mono text-xs',
                        row.isCritical ? 'text-red-300' : 'text-[#ccc]',
                      )}
                    >
                      {row.path}
                    </span>
                    {row.isCritical && (
                      <Badge tone="red" className="ml-2 text-[10px] py-0 px-1">
                        critical
                      </Badge>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-[#aaa]">{row.lastPerson.githubLogin}</td>
                  <td className="py-2.5 text-right text-[#555] text-xs">
                    {row.lastPerson.leftAt ? timeAgo(row.lastPerson.leftAt) : 'inactive'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ── Share modal ───────────────────────────────────────────────────────────────

function ShareModal({
  repoId,
  onClose,
}: {
  repoId: string
  onClose: () => void
}) {
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const create = useMutation({
    mutationFn: () =>
      fetch(`${API_URL}/api/hc/${repoId}/share`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      }).then((r) => r.json() as Promise<{ token: string; expiresAt: string }>),
    onSuccess: (data) => setToken(data.token),
  })

  const shareUrl = token
    ? `${window.location.origin}/report/share/${token}`
    : null

  function copy() {
    if (!shareUrl) return
    void navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[#333] bg-[#111] p-6"
        onClick={(e) => e.stopPropagation()}
        data-testid="share-modal"
      >
        <h3 className="text-sm font-semibold text-white mb-1">Share this report</h3>
        <p className="text-xs text-[#666] mb-5">
          Anyone with this link can view a read-only snapshot. Link expires in 14 days.
        </p>

        {!token ? (
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending}
            data-testid="generate-link-btn"
            className="w-full py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-[#ddd] transition-colors disabled:opacity-50"
          >
            {create.isPending ? 'Generating…' : 'Generate shareable link'}
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              readOnly
              value={shareUrl ?? ''}
              className="flex-1 text-xs bg-[#0d0d0d] border border-[#333] rounded-lg px-3 py-2 text-[#aaa] font-mono"
              data-testid="share-url-input"
            />
            <button
              onClick={copy}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-[#333] bg-[#1a1a1a] text-[#aaa] hover:text-white transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Report view (shared between auth'd page and public share page) ─────────────

export function DarkCodeReportView({
  data,
  readOnly = false,
  repoId,
}: {
  data: DarkCodeReportData
  readOnly?: boolean
  repoId: string
}) {
  const qc = useQueryClient()
  const [shareOpen, setShareOpen] = useState(false)
  const { repo, headline, fragileAndDark, singlePersonAreas, darkByMonth, offboarding } = data

  const verdict = useMutation({
    mutationFn: ({ failureId, v }: { failureId: string; v: 'confirmed' | 'dismissed' }) =>
      fetch(`${API_URL}/api/hc/${repoId}/failures/${failureId}/verdict`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verdict: v }),
      }).then((r) => r.json()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hc-report', repoId] })
    },
  })

  function handleVerdict(failureId: string, v: 'confirmed' | 'dismissed') {
    verdict.mutate({ failureId, v })
  }

  const chartData = darkByMonth.map((d) => ({
    month: fmtMonth(d.month),
    'AI risk': d.ai,
    'Human coverage': d.other,
  }))

  return (
    <>
      {shareOpen && !readOnly && (
        <ShareModal repoId={repoId} onClose={() => setShareOpen(false)} />
      )}

      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-6 print:space-y-4">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 print:hidden">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <EyeOff className="h-5 w-5 text-[#555]" />
              Dark Code Report
            </h1>
            <p className="text-sm text-[#666] mt-0.5">
              {repo.owner}/{repo.name}
            </p>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#333] bg-[#1a1a1a] text-[#888] hover:text-white hover:border-[#555] transition-colors"
                data-testid="pdf-export-btn"
              >
                <Download className="h-3.5 w-3.5" />
                Export PDF
              </button>
              <button
                onClick={() => setShareOpen(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#333] bg-[#1a1a1a] text-[#888] hover:text-white hover:border-[#555] transition-colors"
                data-testid="share-btn"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </button>
            </div>
          )}
        </div>

        {/* Print header (visible only in print) */}
        <div className="hidden print:block mb-4">
          <h1 className="text-2xl font-bold">Dark Code Report — {repo.owner}/{repo.name}</h1>
          <p className="text-sm text-gray-500 mt-1">Generated {new Date().toLocaleDateString()}</p>
        </div>

        {/* Headline */}
        <Card>
          <div className="flex items-center gap-2 mb-5">
            <Moon className="h-4 w-4 text-[#555]" />
            <h2 className="text-sm font-semibold text-white">Coverage Overview</h2>
          </div>
          <div className="flex items-end gap-6 mb-6">
            <div>
              <div
                className={cn(
                  'text-5xl font-bold tabular-nums',
                  headline.darkPct > 50 ? 'text-red-400' : headline.darkPct > 25 ? 'text-yellow-400' : 'text-green-400',
                )}
                data-testid="dark-pct"
              >
                {headline.darkPct}%
              </div>
              <div className="text-xs text-[#666] mt-1">
                of {headline.totalAreas} active areas are dark
              </div>
            </div>
            <div className="text-sm text-[#555]">
              {headline.darkAreas} dark · {headline.totalAreas - headline.darkAreas} covered
            </div>
          </div>

          {/* Trend bar chart */}
          <div style={{ height: 140 }} data-testid="trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={headline.trend.map((t) => ({
                month: fmtMonth(t.month),
                'Coverage gained': t.humanCoverage,
                'AI risk added': t.aiRisk,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ background: '#111', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#aaa' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Bar dataKey="Coverage gained" fill="#22c55e" radius={[2, 2, 0, 0]} maxBarSize={24} />
                <Bar dataKey="AI risk added" fill="#ef4444" radius={[2, 2, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Fragile & dark — always first */}
        <FragileAndDark
          rows={fragileAndDark}
          repoOwner={repo.owner}
          repoName={repo.name}
          onVerdict={handleVerdict}
          readOnly={readOnly}
        />

        {/* Single-person areas */}
        <SinglePersonAreas rows={singlePersonAreas} />

        {/* Dark code by month */}
        <Card>
          <SectionHeader
            icon={<TrendingDown className="h-4 w-4" />}
            title="Dark Code Added per Month"
            color="text-[#888]"
          />
          {darkByMonth.every((d) => d.ai === 0 && d.other === 0) ? (
            <EmptyState message="No data yet — run the backfill first." />
          ) : (
            <div style={{ height: 180 }} data-testid="dark-by-month-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ background: '#111', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#aaa' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#666' }} />
                  <Bar dataKey="AI risk" fill="#ef4444" radius={[2, 2, 0, 0]} maxBarSize={24} stackId="a" />
                  <Bar dataKey="Human coverage" fill="#22c55e" radius={[2, 2, 0, 0]} maxBarSize={24} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Offboarding */}
        <OffboardingView rows={offboarding} />
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .print\\:hidden { display: none !important; }
          .hidden.print\\:block { display: block !important; }
          [class*="border-[#"] { border-color: #ccc !important; }
          [class*="bg-[#"] { background: #f8f8f8 !important; }
          [class*="text-[#"] { color: #333 !important; }
          .text-white { color: #000 !important; }
          .text-green-400 { color: #16a34a !important; }
          .text-red-400 { color: #dc2626 !important; }
          .text-yellow-400 { color: #ca8a04 !important; }
          button { display: none !important; }
        }
      `}</style>
    </>
  )
}

// ── Authenticated Dark Code Report page ───────────────────────────────────────

export function DarkCodeReportPage() {
  const [searchParams] = useSearchParams()
  const repoId = searchParams.get('repo') ?? ''

  const repos = useQuery({
    queryKey: ['repos'],
    queryFn: api.repos.list,
  })

  const firstRepoId = repos.data?.[0]?.id ?? ''
  const activeRepoId = repoId || firstRepoId

  const report = useQuery({
    queryKey: ['hc-report', activeRepoId],
    queryFn: (): Promise<DarkCodeReportData> =>
      fetch(`${API_URL}/api/hc/${activeRepoId}/report`, {
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      }).then((r) => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json() as Promise<DarkCodeReportData>
      }),
    enabled: !!activeRepoId,
  })

  if (repos.isLoading || report.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!activeRepoId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <EyeOff className="h-8 w-8 text-[#333]" />
        <p className="text-sm text-[#555]">Connect a repo to see the Dark Code Report.</p>
      </div>
    )
  }

  if (report.isError || !report.data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <p className="text-sm text-[#555]">
          {report.error instanceof Error && report.error.message === '404'
            ? 'Repo not found or backfill not yet run.'
            : 'Failed to load report.'}
        </p>
      </div>
    )
  }

  return (
    <DarkCodeReportView
      data={report.data}
      repoId={activeRepoId}
      readOnly={false}
    />
  )
}

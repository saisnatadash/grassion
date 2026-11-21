import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, User, Download, Share2, CheckCircle, XCircle,
  ExternalLink, EyeOff, Moon, Users, TrendingDown, Copy, Check,
  ChevronDown,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts'
import { api, type TrendPoint } from '../lib/api.js'
import { useInstallPopup } from '../lib/install-popup.js'
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

interface HeadlineTrendPoint {
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
    trend: HeadlineTrendPoint[]
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

// ── Auth-aware fetch helper ────────────────────────────────────────────────────
// Mirrors the api.ts request helper so Bearer + cookie auth both work.

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || 'https://grassion-api.fly.dev'

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('grassion_token')
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  return res
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Small shared components ───────────────────────────────────────────────────

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
    <div className={cn('rounded-xl border border-[#222222] bg-[#111111] p-4 sm:p-5', className)}>
      {children}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-[#555] py-6 text-center">{message}</p>
}

function NextStep({ n, text, done }: { n: number; text: string; done: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={cn(
        'flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold mt-0.5',
        done ? 'bg-green-500/20 text-green-400' : 'bg-[#222] text-[#555]',
      )}>{done ? '✓' : n}</span>
      <p className="text-xs text-[#888]">{text}</p>
    </div>
  )
}

// ── Fragile & Dark section ────────────────────────────────────────────────────

function FragileAndDark({
  rows,
  repoOwner,
  repoName,
  onVerdict,
  pendingId,
  readOnly,
}: {
  rows: DarkCodeReportData['fragileAndDark']
  repoOwner: string
  repoName: string
  onVerdict: (failureId: string, verdict: 'confirmed' | 'dismissed') => void
  pendingId: string | null
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
              className="rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] p-3 sm:p-4 flex flex-col gap-2"
            >
              {/* Area badges */}
              <div className="flex flex-wrap gap-1.5">
                {areas.map((a) => (
                  <span
                    key={a.id}
                    className={cn(
                      'font-mono text-xs px-2 py-0.5 rounded border break-all',
                      a.isCritical
                        ? 'border-red-900/50 bg-red-950/30 text-red-300'
                        : 'border-[#333] bg-[#1a1a1a] text-[#bbb]',
                    )}
                  >
                    {a.path}
                    {a.isCritical && <span className="ml-1 text-[10px] text-red-400">critical</span>}
                  </span>
                ))}
              </div>

              {/* PR links */}
              <div className="flex flex-wrap gap-2 sm:gap-3 text-xs">
                {failure.originalPr && (
                  <a
                    href={prLink(repoOwner, repoName, failure.originalPr)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[#888] hover:text-white transition-colors"
                    data-testid="original-pr-link"
                  >
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
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
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
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
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                    Fix #{failure.fixPr}
                  </a>
                )}
              </div>

              {/* Test file names */}
              {failure.testNames.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {failure.testNames.map((t) => (
                    <span
                      key={t}
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#222] text-[#aaa] border border-[#333] break-all"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {/* Verdict */}
              {!readOnly && failure.state === 'candidate' && (
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <button
                    onClick={() => onVerdict(failure.id, 'confirmed')}
                    disabled={pendingId === failure.id}
                    data-testid="confirm-btn"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-green-900/40 bg-green-950/20 text-green-400 hover:bg-green-950/40 transition-colors disabled:opacity-50"
                  >
                    <CheckCircle className="h-3 w-3 flex-shrink-0" />
                    Confirm failure
                  </button>
                  <button
                    onClick={() => onVerdict(failure.id, 'dismissed')}
                    disabled={pendingId === failure.id}
                    data-testid="dismiss-btn"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#333] bg-[#1a1a1a] text-[#888] hover:text-white hover:border-[#555] transition-colors disabled:opacity-50"
                  >
                    <XCircle className="h-3 w-3 flex-shrink-0" />
                    Not a real failure
                  </button>
                  {pendingId === failure.id && <Spinner className="h-3.5 w-3.5" />}
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

function SinglePersonAreas({ rows }: { rows: DarkCodeReportData['singlePersonAreas'] }) {
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
        <>
          {/* Mobile: card list */}
          <div className="flex flex-col gap-2 sm:hidden">
            {rows.map((row) => (
              <div key={row.areaId} className="rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] p-3 flex flex-col gap-1">
                <span className={cn('font-mono text-xs break-all', row.isCritical ? 'text-red-300' : 'text-[#ccc]')}>
                  {row.path}
                  {row.isCritical && <Badge tone="red" className="ml-2 text-[10px] py-0 px-1">critical</Badge>}
                </span>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-[#aaa]">
                    <User className="h-3 w-3 text-[#555]" />
                    {row.person.githubLogin}
                  </span>
                  <span className="text-[#555]">{row.lastChangedAt ? timeAgo(row.lastChangedAt) : '—'}</span>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop: table */}
          <div className="hidden sm:block overflow-x-auto">
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
                  <tr key={row.areaId} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-2.5 pr-4">
                      <span className={cn('font-mono text-xs', row.isCritical ? 'text-red-300' : 'text-[#ccc]')}>
                        {row.path}
                      </span>
                      {row.isCritical && (
                        <Badge tone="red" className="ml-2 text-[10px] py-0 px-1">critical</Badge>
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
        </>
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
        <>
          {/* Mobile: card list */}
          <div className="flex flex-col gap-2 sm:hidden">
            {rows.map((row) => (
              <div key={row.areaId} className="rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] p-3 flex flex-col gap-1">
                <span className={cn('font-mono text-xs break-all', row.isCritical ? 'text-red-300' : 'text-[#ccc]')}>
                  {row.path}
                  {row.isCritical && <Badge tone="red" className="ml-2 text-[10px] py-0 px-1">critical</Badge>}
                </span>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#aaa]">{row.lastPerson.githubLogin}</span>
                  <span className="text-[#555]">{row.lastPerson.leftAt ? timeAgo(row.lastPerson.leftAt) : 'inactive'}</span>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop: table */}
          <div className="hidden sm:block overflow-x-auto">
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
                  <tr key={row.areaId} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-2.5 pr-4">
                      <span className={cn('font-mono text-xs', row.isCritical ? 'text-red-300' : 'text-[#ccc]')}>
                        {row.path}
                      </span>
                      {row.isCritical && (
                        <Badge tone="red" className="ml-2 text-[10px] py-0 px-1">critical</Badge>
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
        </>
      )}
    </Card>
  )
}

// ── Share modal ───────────────────────────────────────────────────────────────

function ShareModal({ repoId, onClose }: { repoId: string; onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const create = useMutation({
    mutationFn: async () => {
      const r = await authedFetch(`/api/hc/${repoId}/share`, { method: 'POST' })
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<{ token: string; expiresAt: string }>
    },
    onSuccess: (data) => setToken(data.token),
  })

  const shareUrl = token ? `${window.location.origin}/report/share/${token}` : null

  function copy() {
    if (!shareUrl) return
    void navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[#333] bg-[#111] p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
        data-testid="share-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Share report"
      >
        <h3 className="text-sm font-semibold text-white mb-1">Share this report</h3>
        <p className="text-xs text-[#666] mb-5">
          Anyone with this link can view a read-only snapshot. Link expires in 14 days.
        </p>

        {create.isError && (
          <p className="text-xs text-red-400 mb-3">Failed to generate link. Try again.</p>
        )}

        {!token ? (
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending}
            data-testid="generate-link-btn"
            className="w-full py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-[#ddd] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {create.isPending && <Spinner className="h-3.5 w-3.5 border-black/30 border-t-black" />}
            {create.isPending ? 'Generating…' : 'Generate shareable link'}
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              readOnly
              value={shareUrl ?? ''}
              className="flex-1 min-w-0 text-xs bg-[#0d0d0d] border border-[#333] rounded-lg px-3 py-2 text-[#aaa] font-mono"
              data-testid="share-url-input"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              onClick={copy}
              className="flex-shrink-0 flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-[#333] bg-[#1a1a1a] text-[#aaa] hover:text-white transition-colors"
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

// ── Repo selector ─────────────────────────────────────────────────────────────

function RepoSelector({
  repos,
  activeId,
  onChange,
}: {
  repos: Array<{ id: string; owner: string; name: string }>
  activeId: string
  onChange: (id: string) => void
}) {
  if (repos.length <= 1) return null
  return (
    <div className="relative inline-flex items-center">
      <select
        value={activeId}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="appearance-none bg-[#1a1a1a] border border-[#333] rounded-lg pl-3 pr-8 py-1.5 text-xs text-[#aaa] focus:outline-none focus:border-[#555] cursor-pointer"
        aria-label="Select repository"
      >
        {repos.map((r) => (
          <option key={r.id} value={r.id}>{r.owner}/{r.name}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-[#555]" />
    </div>
  )
}

// ── Shared report view ────────────────────────────────────────────────────────

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
  const [pendingVerdictId, setPendingVerdictId] = useState<string | null>(null)
  const { repo, headline, fragileAndDark, singlePersonAreas, darkByMonth, offboarding } = data

  const verdict = useMutation({
    mutationFn: async ({ failureId, v }: { failureId: string; v: 'confirmed' | 'dismissed' }) => {
      setPendingVerdictId(failureId)
      const r = await authedFetch(`/api/hc/${repoId}/failures/${failureId}/verdict`, {
        method: 'POST',
        body: JSON.stringify({ verdict: v }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `http_${r.status}`)
      }
      return r.json() as Promise<{ id: string; state: string }>
    },
    onSettled: () => setPendingVerdictId(null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hc-report', repoId] })
    },
    onError: (err) => {
      // Surface error briefly — a full toast system is out of scope here
      console.error('verdict failed:', err)
    },
  })

  function handleVerdict(failureId: string, v: 'confirmed' | 'dismissed') {
    verdict.mutate({ failureId, v })
  }

  // Dark-by-month: grouped bar chart showing AI-risk events vs coverage events per month
  const darkByMonthChart = darkByMonth.map((d) => ({
    month: fmtMonth(d.month),
    'AI risk': d.ai,
    'Coverage': d.other,
  }))

  const hasMonthData = darkByMonth.some((d) => d.ai > 0 || d.other > 0)

  return (
    <>
      {shareOpen && !readOnly && (
        <ShareModal repoId={repoId} onClose={() => setShareOpen(false)} />
      )}

      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-8 space-y-5 sm:space-y-6 print:space-y-4">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 print:hidden">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
              <EyeOff className="h-5 w-5 text-[#555] flex-shrink-0" />
              Dark Code Report
            </h1>
            <p className="text-sm text-[#666] mt-0.5 truncate">{repo.owner}/{repo.name}</p>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#333] bg-[#1a1a1a] text-[#888] hover:text-white hover:border-[#555] transition-colors"
                data-testid="pdf-export-btn"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export PDF</span>
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

        {/* Print-only header */}
        <div className="hidden print:block mb-4">
          <h1 className="text-2xl font-bold text-black">Dark Code Report: {repo.owner}/{repo.name}</h1>
          <p className="text-sm text-gray-500 mt-1">Generated {new Date().toLocaleDateString()}</p>
        </div>

        {/* Headline */}
        <Card>
          <div className="flex items-center gap-2 mb-4 sm:mb-5">
            <Moon className="h-4 w-4 text-[#555]" />
            <h2 className="text-sm font-semibold text-white">Coverage Overview</h2>
          </div>

          <div className="flex flex-wrap items-end gap-4 sm:gap-6 mb-5 sm:mb-6">
            <div>
              <div
                className={cn(
                  'text-4xl sm:text-5xl font-bold tabular-nums',
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
            <div className="flex gap-4 sm:gap-6 text-sm">
              <span className="text-[#555]"><span className="text-[#aaa] font-medium">{headline.darkAreas}</span> dark</span>
              <span className="text-[#555]"><span className="text-green-500 font-medium">{headline.totalAreas - headline.darkAreas}</span> covered</span>
            </div>
          </div>

          <div style={{ height: 130 }} data-testid="trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={headline.trend.map((t) => ({
                  month: fmtMonth(t.month),
                  'Coverage': t.humanCoverage,
                  'AI risk': t.aiRisk,
                }))}
                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ background: '#111', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#aaa' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Bar dataKey="Coverage" fill="#22c55e" radius={[2, 2, 0, 0]} maxBarSize={20} />
                <Bar dataKey="AI risk" fill="#ef4444" radius={[2, 2, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Fragile & dark — first per spec */}
        <FragileAndDark
          rows={fragileAndDark}
          repoOwner={repo.owner}
          repoName={repo.name}
          onVerdict={handleVerdict}
          pendingId={pendingVerdictId}
          readOnly={readOnly}
        />

        {/* Single-person areas */}
        <SinglePersonAreas rows={singlePersonAreas} />

        {/* Dark code added per month */}
        <Card>
          <SectionHeader
            icon={<TrendingDown className="h-4 w-4" />}
            title="Dark Code Added per Month"
            color="text-[#888]"
          />
          {!hasMonthData ? (
            <EmptyState message="No data yet. Run the backfill to populate this chart." />
          ) : (
            <div style={{ height: 180 }} data-testid="dark-by-month-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={darkByMonthChart}
                  margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ background: '#111', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#aaa' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#666' }} />
                  {/* Grouped (not stacked) — AI risk and Coverage are separate metrics */}
                  <Bar dataKey="AI risk" fill="#ef4444" radius={[2, 2, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="Coverage" fill="#22c55e" radius={[2, 2, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Offboarding */}
        <OffboardingView rows={offboarding} />
      </div>

      {/* Print styles — inlined because Tailwind print variants are JIT-only and don't cover arbitrary values */}
      <style>{`
        @media print {
          .print-hide { display: none !important; }
          body { background: #fff !important; color: #000 !important; }
        }
      `}</style>
    </>
  )
}

// ── Backfill status types ─────────────────────────────────────────────────────

interface BackfillStatus {
  status: 'none' | 'running' | 'complete' | 'failed'
  statusDetail?: string | null
  progressPct?: number | null
  prsFetched?: number | null
  error?: string | null
}

// ── Onboarding screen ────────────────────────────────────────────────────────

interface OnboardingScreenProps {
  repoName: string | null
  repoOwner: string | null
  activeRepoId: string
  backfillStatus: BackfillStatus | undefined
  syncPending: boolean
  onImport: () => void
}

function OnboardingStep({ n, label, done, active }: { n: number; label: string; done: boolean; active: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn(
        'flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold',
        done ? 'bg-green-500/20 text-green-400 border border-green-500/30'
          : active ? 'bg-white/10 text-white border border-white/20'
          : 'bg-[#1a1a1a] text-[#444] border border-[#333]',
      )}>
        {done ? '✓' : n}
      </span>
      <p className={cn('text-sm', done ? 'text-[#888]' : active ? 'text-white font-medium' : 'text-[#555]')}>{label}</p>
    </div>
  )
}

function OnboardingScreen({ repoName, repoOwner, activeRepoId, backfillStatus: bs, syncPending, onImport }: OnboardingScreenProps) {
  const isRunning = bs?.status === 'running'
  const isFailed = bs?.status === 'failed'
  const pct = bs?.progressPct ?? 0
  const detail = bs?.statusDetail

  if (isRunning) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-5">
          <div className="text-center space-y-1">
            <p className="text-white font-semibold text-base">Building your knowledge map</p>
            <p className="text-[#555] text-sm">This usually takes 2 to 5 minutes</p>
          </div>
          <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Spinner className="h-3 w-3 flex-shrink-0" />
              <p className="text-xs text-[#aaa] font-medium">{detail ?? 'Analyzing pull requests…'}</p>
            </div>
            {pct > 0 && (
              <div className="space-y-1.5">
                <div className="h-1.5 rounded-full bg-[#1f1f1f] overflow-hidden">
                  <div
                    className="h-full bg-white/40 rounded-full transition-all duration-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[10px] text-[#555] text-right">{pct}%</p>
              </div>
            )}
          </div>
          <p className="text-center text-xs text-[#444]">
            Running in the background. You can leave this page and come back.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">

        {/* Header */}
        <div className="text-center space-y-1.5">
          <p className="text-white font-semibold text-lg">Set up your knowledge map</p>
          <p className="text-[#555] text-sm">
            See who truly understands every part of your codebase
          </p>
        </div>

        {/* Step checklist */}
        <div className="rounded-xl border border-[#222] bg-[#0d0d0d] p-5 space-y-3.5">
          <OnboardingStep n={1} label="GitHub App installed" done={true} active={false} />
          <OnboardingStep
            n={2}
            label={repoOwner && repoName ? `Repo connected: ${repoOwner}/${repoName}` : 'Repository connected'}
            done={true}
            active={false}
          />
          <OnboardingStep n={3} label="Import 12 months of PR history" done={false} active={true} />
        </div>

        {/* Error state */}
        {isFailed && (
          <div className="rounded-xl border border-red-900/40 bg-red-950/10 p-3">
            <p className="text-xs font-medium text-red-400 mb-0.5">Last import failed</p>
            {bs?.error && <p className="text-xs text-red-300/60 font-mono break-all">{bs.error}</p>}
          </div>
        )}

        {/* Import CTA */}
        {activeRepoId && (
          <button
            type="button"
            disabled={syncPending}
            onClick={onImport}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:opacity-85 disabled:opacity-50 transition-opacity"
          >
            {syncPending ? (
              <><Spinner className="h-3.5 w-3.5 border-black/30 border-t-black" /><span>Starting import…</span></>
            ) : isFailed ? (
              <span>Retry import</span>
            ) : (
              <span>Import last 12 months of PRs</span>
            )}
          </button>
        )}

        {/* What you'll unlock */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-[#444] uppercase tracking-wider px-1">After import you will see</p>
          <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] divide-y divide-[#1a1a1a]">
            {[
              { icon: Users, title: 'Knowledge map', desc: 'Who understands each file area' },
              { icon: User, title: 'Single-person risks', desc: 'Code only one developer knows' },
              { icon: TrendingDown, title: 'AI coverage gaps', desc: 'AI-written code with no human review' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-3.5">
                <Icon className="h-3.5 w-3.5 text-[#555] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-[#999]">{title}</p>
                  <p className="text-xs text-[#555]">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-[#333]">
          Add a <span className="text-[#555]">copilot</span> or <span className="text-[#555]">cursor</span> label to AI-assisted PRs to track AI ROI
        </p>
      </div>
    </div>
  )
}

// ── Merge Receipt trend section ───────────────────────────────────────────────

function TrendSection({ repoId }: { repoId: string }) {
  const trend = useQuery({
    queryKey: ['hc-trend', repoId],
    queryFn: () => api.hc.trend(repoId, 6),
    enabled: !!repoId,
    staleTime: 5 * 60_000,
  })

  if (trend.isLoading) return null
  const data = trend.data
  if (!data || data.length === 0 || data.every((d) => d.totalPrs === 0)) {
    return (
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pb-6">
        <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] px-5 py-4">
          <p className="text-xs font-semibold text-[#555] uppercase tracking-wide mb-1">Merge Receipt Trend</p>
          <p className="text-sm text-[#444]">No data yet — will populate as PRs are merged.</p>
        </div>
      </div>
    )
  }

  // Only include months that have at least one PR
  const chartData = data
    .filter((d) => d.totalPrs > 0)
    .map((d) => ({
      month: d.month.slice(5),   // "2026-11" → "11"
      'AI-heavy %': d.aiHeavyPct,
      'Attested %': d.attestedPct,
    }))

  if (chartData.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pb-6">
        <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] px-5 py-4">
          <p className="text-xs font-semibold text-[#555] uppercase tracking-wide mb-1">Merge Receipt Trend</p>
          <p className="text-sm text-[#444]">No data yet — will populate as PRs are merged.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pb-6">
      <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] p-5">
        <p className="text-xs font-semibold text-[#555] uppercase tracking-wide mb-4">Merge Receipt Trend</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: '#555', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#555', fontSize: 10 }} axisLine={false} tickLine={false} width={28} unit="%" />
            <Tooltip
              contentStyle={{ background: '#111', border: '1px solid #222', borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: '#888' }}
            />
            <Legend wrapperStyle={{ fontSize: 10, color: '#555' }} />
            <Bar dataKey="AI-heavy %" fill="#4f8ef7" radius={[2, 2, 0, 0]} maxBarSize={32} />
            <Bar dataKey="Attested %" fill="#22c55e" radius={[2, 2, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Authenticated Dark Code Report page ───────────────────────────────────────

export function DarkCodeReportPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { open: openInstall } = useInstallPopup()
  const repoId = searchParams.get('repo') ?? ''
  const qc = useQueryClient()

  const reposQuery = useQuery({
    queryKey: ['repos'],
    queryFn: api.repos.list,
  })

  const [polling, setPolling] = useState(false)

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.repos.sync(id),
    onSuccess: () => setPolling(true),
  })

  const repoList = reposQuery.data ?? []
  const firstRepoId = repoList[0]?.id ?? ''
  const activeRepoId = repoId || firstRepoId

  // Sync first repo into URL once loaded
  const synced = useRef(false)
  useEffect(() => {
    if (synced.current) return
    if (!repoId && firstRepoId) {
      synced.current = true
      setSearchParams({ repo: firstRepoId }, { replace: true })
    }
  }, [firstRepoId, repoId, setSearchParams])

  const report = useQuery({
    queryKey: ['hc-report', activeRepoId],
    queryFn: (): Promise<DarkCodeReportData> =>
      authedFetch(`/api/hc/${activeRepoId}/report`).then((r) => {
        if (!r.ok) throw Object.assign(new Error(`${r.status}`), { status: r.status })
        return r.json() as Promise<DarkCodeReportData>
      }),
    enabled: !!activeRepoId,
    retry: (failCount, err) => {
      const status = (err as { status?: number }).status
      if (status === 404) return false
      return failCount < 2
    },
    refetchInterval: polling ? 5_000 : false,
  })

  // Stop polling once report has actual area data
  useEffect(() => {
    if (polling && (report.data?.headline.totalAreas ?? 0) > 0) setPolling(false)
  }, [polling, report.data])

  // Poll backfill status — always enabled when a repo is selected so we catch
  // in-progress runs even after a page refresh. Polls every 5s while running.
  const backfillStatus = useQuery({
    queryKey: ['backfill-status', activeRepoId],
    queryFn: (): Promise<BackfillStatus> =>
      authedFetch(`/api/hc/${activeRepoId}/backfill-status`).then((r) => {
        if (!r.ok) return { status: 'none' } as BackfillStatus
        return r.json() as Promise<BackfillStatus>
      }),
    enabled: !!activeRepoId && !(report.data?.headline.totalAreas),
    refetchInterval: (query) => {
      const data = query.state.data
      return data?.status === 'running' ? 5_000 : false
    },
  })

  // Drive report polling from backfill status
  useEffect(() => {
    if (backfillStatus.data?.status === 'running' && !polling) setPolling(true)
    if (backfillStatus.data?.status === 'complete' && !(report.data?.headline.totalAreas)) {
      void qc.invalidateQueries({ queryKey: ['hc-report', activeRepoId] })
    }
  }, [backfillStatus.data?.status, activeRepoId, polling, report.data, qc])

  // Auto-trigger sync when page loads with no data and no backfill running yet.
  // Fires once per mount so the user never has to click Import manually.
  const autoTriggered = useRef(false)
  useEffect(() => {
    if (autoTriggered.current || !activeRepoId) return
    if (!backfillStatus.isFetched) return
    if (backfillStatus.data?.status !== 'none') return
    if ((report.data?.headline.totalAreas ?? 0) > 0) return
    autoTriggered.current = true
    syncMutation.mutate(activeRepoId)
  }, [activeRepoId, backfillStatus.isFetched, backfillStatus.data?.status, report.data, syncMutation])

  function handleRepoChange(id: string) {
    setSearchParams({ repo: id }, { replace: true })
  }

  if (reposQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (repoList.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center px-4">
        <EyeOff className="h-8 w-8 text-[#333]" />
        <div>
          <p className="text-sm font-medium text-white mb-1">No repositories connected</p>
          <p className="text-xs text-[#555] max-w-xs mx-auto">Install the Grassion GitHub App and choose which repos to track.</p>
        </div>
        <button
          type="button"
          onClick={openInstall}
          className="inline-flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-white text-black font-semibold hover:opacity-85 transition-opacity"
        >
          Install GitHub App &amp; choose repos
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
    )
  }

  const typedRepos = repoList as Array<{ id: string; owner: string; name: string }>

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Repo selector bar */}
      {typedRepos.length > 1 && (
        <div className="border-b border-[#1a1a1a] bg-[#0d0d0d] px-4 sm:px-6 py-2 flex items-center gap-3">
          <span className="text-xs text-[#555]">Repo:</span>
          <RepoSelector
            repos={typedRepos}
            activeId={activeRepoId}
            onChange={handleRepoChange}
          />
        </div>
      )}

      {report.isLoading && (
        <div className="flex min-h-[50vh] items-center justify-center">
          <Spinner />
        </div>
      )}

      {(report.isError || (!report.isLoading && !(report.data?.headline.totalAreas))) && (
        <OnboardingScreen
          repoName={typedRepos.find(r => r.id === activeRepoId)?.name ?? null}
          repoOwner={typedRepos.find(r => r.id === activeRepoId)?.owner ?? null}
          activeRepoId={activeRepoId}
          backfillStatus={backfillStatus.data ?? (syncMutation.isPending ? { status: 'running' } : undefined)}
          syncPending={syncMutation.isPending}
          onImport={() => activeRepoId && syncMutation.mutate(activeRepoId)}
        />
      )}

      {report.data && report.data.headline.totalAreas > 0 && (
        <>
          <DarkCodeReportView
            data={report.data}
            repoId={activeRepoId}
            readOnly={false}
          />
          <TrendSection repoId={activeRepoId} />
        </>
      )}
    </div>
  )
}

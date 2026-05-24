import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  UserX, Users, TrendingDown, AlertCircle, Download, Lock,
  ExternalLink, Copy, Check, Zap, BarChart2,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, type SeatWasteResponse, type OutcomesToolRow } from '../lib/api.js'
import { formatUsd, cn } from '../lib/utils.js'
import { usePlan } from '../lib/plan.js'
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner, StatCard } from '../components/ui.js'

type ActiveUser = SeatWasteResponse['activeUsers'][number]
type InactiveUser = SeatWasteResponse['inactiveUsers'][number]

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  copilot: 'GitHub Copilot',
  cursor: 'Cursor',
  'claude-code': 'Claude Code',
  codeium: 'Codeium',
  tabnine: 'Tabnine',
  windsurf: 'Windsurf',
  'ai-assisted': 'AI-Assisted',
}

function toolDisplayName(key: string): string {
  return TOOL_DISPLAY_NAMES[key] ?? key
}

function verdictLabel(v: 'high_quality' | 'average' | 'low_quality'): string {
  if (v === 'high_quality') return 'Strong ROI'
  if (v === 'average') return 'Medium ROI'
  return 'Low ROI'
}

function verdictTone(v: 'high_quality' | 'average' | 'low_quality'): 'green' | 'yellow' | 'red' {
  if (v === 'high_quality') return 'green'
  if (v === 'average') return 'yellow'
  return 'red'
}

function daysAgo(iso: string | null): string {
  if (!iso) return 'never'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (d === 0) return 'today'
  if (d === 1) return '1 day ago'
  return `${d} days ago`
}

export function SpendIntelligencePage() {
  const seatWaste = useQuery({
    queryKey: ['analytics', 'seat-waste'],
    queryFn: api.analytics.seatWaste,
  })
  const outcomes = useQuery({
    queryKey: ['analytics', 'outcomes'],
    queryFn: api.analytics.outcomes,
  })
  const { isPaid } = usePlan()

  if (seatWaste.isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-32 text-[#888888]">
        <Spinner />
        <span className="text-sm">Analysing AI spend…</span>
      </div>
    )
  }

  if (seatWaste.isError || !seatWaste.data) {
    return (
      <div className="space-y-4">
        <Alert tone="red">Failed to load spend data. Check your connection and try again.</Alert>
        <Button variant="secondary" onClick={() => seatWaste.refetch()}>Retry</Button>
      </div>
    )
  }

  const data = seatWaste.data
  const monthlyWaste = data.totalMonthlySavings
  const annualWaste = monthlyWaste * 12
  const hasInactive = data.inactiveUsers.length > 0
  const perSeat = data.inactiveUsers[0]?.monthlyCost ?? 0
  const qualityScore = outcomes.data?.aiPrQualityScore ?? null
  const toolBreakdown = outcomes.data?.toolBreakdown ?? []

  const allUsers: Array<{ user: ActiveUser | InactiveUser; active: boolean }> = [
    ...data.inactiveUsers.map((u) => ({ user: u, active: false })),
    ...data.activeUsers.map((u) => ({ user: u, active: true })),
  ]

  const qualityTone = qualityScore !== null
    ? (qualityScore >= 75 ? 'green' : qualityScore < 50 ? 'red' : 'white') as 'green' | 'red' | 'white'
    : 'white' as const

  return (
    <div className="space-y-6">

      {/* ── HEADER ── */}
      <div>
        <h1 className="text-2xl font-semibold text-white">AI Spend Intelligence</h1>
        <p className="mt-1 text-sm text-[#888888]">
          Track which AI tool spend is producing real engineering value — and which is creating low-confidence output or going completely unused.
        </p>
      </div>

      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Seats"
          value={data.totalSeats}
          sub="active PR authors · 30d"
        />
        <StatCard
          label="Active"
          value={data.activeUsers.length}
          sub="AI PR in last 7d"
          tone="green"
        />
        <StatCard
          label="Low-Confidence Spend"
          value={formatUsd(monthlyWaste)}
          sub={perSeat > 0 ? `${formatUsd(perSeat)}/seat · no AI PRs last 7d` : 'no waste detected'}
          tone={monthlyWaste > 0 ? 'red' : 'white'}
        />
        <StatCard
          label="Quality Score"
          value={qualityScore !== null ? `${qualityScore}/100` : '—'}
          sub={outcomes.data ? verdictLabel(outcomes.data.verdict) : 'computing…'}
          tone={qualityTone}
        />
      </div>

      {/* ── LOW-CONFIDENCE SPEND ALERT ── */}
      {hasInactive && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-6 py-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <TrendingDown className="h-5 w-5 text-red-500" />
            <span className="text-xs font-semibold uppercase tracking-widest text-[#888888]">
              AI Spend Producing Low-Confidence Output
            </span>
          </div>
          <div className="text-5xl font-bold text-red-500 tabular-nums">
            {formatUsd(monthlyWaste)}
            <span className="text-2xl font-normal text-[#888] ml-1">/mo</span>
          </div>
          <div className="text-sm text-[#888888] mt-2">
            from {data.inactiveUsers.length} seat{data.inactiveUsers.length === 1 ? '' : 's'} with zero AI PR output in the last 7 days
          </div>
          <div className="mt-2 text-sm font-semibold text-red-400 tabular-nums">
            {formatUsd(annualWaste)}/year at current rate
          </div>
          <div className="mt-4">
            <Badge tone="red">Action required — remove inactive seats to recover this spend</Badge>
          </div>
        </div>
      )}

      {/* ── SPEND VS QUALITY ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 className="h-4 w-4 text-[#888]" />
          <h2 className="text-sm font-semibold text-white">Spend vs Quality</h2>
          <span className="text-xs text-[#555]">per-tool breakdown</span>
        </div>

        {outcomes.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-[#555] text-sm">
            <Spinner />
            <span>Loading tool breakdown…</span>
          </div>
        ) : toolBreakdown.length > 0 ? (
          <div className={cn(
            'grid gap-4',
            toolBreakdown.length === 1 ? 'grid-cols-1 max-w-sm' :
            toolBreakdown.length === 2 ? 'grid-cols-1 sm:grid-cols-2' :
            'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
          )}>
            {toolBreakdown.map((tool) => (
              <ToolCard key={tool.tool} tool={tool} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center">
              <Zap className="mx-auto h-8 w-8 text-[#333] mb-3" />
              <p className="text-sm text-[#555555]">
                No AI tool data yet. Spend vs Quality will appear once PRs are synced.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── DEVELOPER LIST ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Developer AI usage</CardTitle>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-[#555555]">
              <span className="h-2 w-2 rounded-full bg-green-500" /> Active
            </span>
            <span className="flex items-center gap-1.5 text-xs text-[#555555]">
              <span className="h-2 w-2 rounded-full bg-red-500" /> Low output
            </span>
            <CsvExportButton isPaid={isPaid} data={data} />
          </div>
        </CardHeader>
        <CardContent>
          {allUsers.length === 0 ? (
            <div className="py-8 text-center">
              <Users className="mx-auto h-8 w-8 text-[#333] mb-3" />
              <p className="text-sm text-[#555555]">No team members found.</p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-[#1a1a1a]">
                {allUsers.map(({ user, active }) => (
                  <DevRow key={user.githubLogin} user={user} active={active} />
                ))}
              </ul>
              {data.inactiveUsers.length > 0 && (
                <p className="mt-4 text-xs text-[#555555] border-t border-[#1a1a1a] pt-4 leading-relaxed">
                  These developers have AI tool seats but produced zero AI-assisted PRs in the last 7 days. Recommended action: check in with them or remove their seat to recover spend.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── RECOMMENDED ACTIONS ── */}
      {data.inactiveUsers.length > 0 && (
        <RecommendedActions inactiveUsers={data.inactiveUsers} />
      )}
    </div>
  )
}

/* ── TOOL CARD ── */
function ToolCard({ tool }: { tool: OutcomesToolRow }) {
  const tone = verdictTone(tool.verdict)
  const borderColor =
    tone === 'green' ? 'border-green-500/30' :
    tone === 'yellow' ? 'border-yellow-500/30' :
    'border-red-500/30'
  const bgColor =
    tone === 'green' ? 'bg-green-500/5' :
    tone === 'yellow' ? 'bg-yellow-500/5' :
    'bg-red-500/5'
  const scoreColor =
    tool.qualityScore >= 75 ? 'text-green-400' :
    tool.qualityScore >= 50 ? 'text-yellow-400' :
    'text-red-400'
  const barColor =
    tone === 'green' ? 'bg-green-500' :
    tone === 'yellow' ? 'bg-yellow-500' :
    'bg-red-500'

  return (
    <div className={cn('rounded-xl border p-5 space-y-4', borderColor, bgColor)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white truncate">{toolDisplayName(tool.tool)}</div>
          {tool.estimatedMonthlySpend > 0 ? (
            <div className="text-xs text-[#888] mt-0.5">{formatUsd(tool.estimatedMonthlySpend)}/month estimated spend</div>
          ) : (
            <div className="text-xs text-[#555] mt-0.5">{tool.prCount} total PR{tool.prCount === 1 ? '' : 's'}</div>
          )}
        </div>
        <Badge tone={tone}>{verdictLabel(tool.verdict)}</Badge>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#888]">Quality score</span>
          <span className={cn('text-sm font-bold tabular-nums', scoreColor)}>{tool.qualityScore}/100</span>
        </div>
        <div className="h-1.5 rounded-full bg-[#222] overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', barColor)}
            style={{ width: `${tool.qualityScore}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-1 border-t border-[#1a1a1a]">
        <Metric label="Total PRs" value={String(tool.prCount)} />
        <Metric
          label="Reverted PRs"
          value={tool.revertedCount > 0 ? `${tool.revertedCount} (${tool.revertRate}%)` : '0'}
          warn={tool.revertedCount > 0}
        />
        <Metric
          label="Hotfix triggered"
          value={tool.hotfixCount > 0 ? `${tool.hotfixCount} (${tool.hotfixRate}%)` : '0'}
          warn={tool.hotfixCount > 0}
        />
        <Metric label="Avg review cycles" value={tool.avgChangesRequested.toFixed(1)} />
      </div>
    </div>
  )
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-xs text-[#555]">{label}</div>
      <div className={cn('text-sm font-semibold mt-0.5', warn ? 'text-red-400' : 'text-white')}>{value}</div>
    </div>
  )
}

/* ── CSV EXPORT BUTTON ── */
function CsvExportButton({ isPaid, data }: { isPaid: boolean; data: SeatWasteResponse | undefined }) {
  function exportCsv() {
    if (!data) return
    const rows = [
      ['Username', 'Status', 'Weekly AI PRs', 'Last Active', 'Monthly Cost'],
      ...data.activeUsers.map((u) => [u.githubLogin, 'Active', String(u.weeklyAiPrs), u.lastActivity ?? 'N/A', '$0']),
      ...data.inactiveUsers.map((u) => [u.githubLogin, 'Low Output', '0', u.lastActivity ?? 'N/A', `$${u.monthlyCost}`]),
    ]
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ai-spend-intelligence.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!isPaid) {
    return (
      <Link
        to="/billing"
        title="Upgrade to Pro to export CSV"
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] bg-[#0a0a0a] px-2.5 py-1.5 text-xs font-medium text-[#555555] cursor-pointer hover:border-yellow-500/40 hover:text-yellow-400 transition-colors"
      >
        <Lock className="h-3 w-3" />
        Export CSV
      </Link>
    )
  }

  return (
    <button
      onClick={exportCsv}
      disabled={!data}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] bg-[#0a0a0a] px-2.5 py-1.5 text-xs font-medium text-[#888888] hover:text-white hover:border-[#555] transition-colors disabled:opacity-40"
    >
      <Download className="h-3 w-3" />
      Export CSV
    </button>
  )
}

/* ── DEV ROW ── */
function DevRow({ user, active }: { user: ActiveUser | InactiveUser; active: boolean }) {
  return (
    <li className="py-3.5 flex items-center gap-4">
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.githubLogin}
          className="h-9 w-9 rounded-full border border-[#333] flex-shrink-0"
        />
      ) : (
        <div className="h-9 w-9 rounded-full bg-[#222] border border-[#333] flex-shrink-0 flex items-center justify-center text-xs font-semibold text-white">
          {user.githubLogin[0]?.toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', active ? 'bg-green-500' : 'bg-red-500')} />
          <span className="text-sm font-medium text-white truncate">@{user.githubLogin}</span>
        </div>
        <div className="text-xs text-[#888888] mt-0.5 pl-4">
          {active
            ? `${(user as ActiveUser).weeklyAiPrs} AI PR${(user as ActiveUser).weeklyAiPrs === 1 ? '' : 's'} this week`
            : `Low output — last active ${daysAgo(user.lastActivity)}`}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {!active && (
          <span className="text-sm font-medium text-red-500 tabular-nums">
            {formatUsd((user as InactiveUser).monthlyCost)}/mo
          </span>
        )}
        <Badge tone={active ? 'green' : 'red'}>{active ? 'Active' : 'Low output'}</Badge>
      </div>
    </li>
  )
}

/* ── RECOMMENDED ACTIONS ── */
function RecommendedActions({ inactiveUsers }: { inactiveUsers: InactiveUser[] }) {
  const [copied, setCopied] = useState(false)

  function copyUsernames() {
    const text = inactiveUsers.map((u) => `@${u.githubLogin}`).join(', ')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-500" />
          <CardTitle>Recover this spend</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-[#1a1a1a]">
          {inactiveUsers.map((u) => (
            <li key={u.githubLogin} className="py-3.5 flex items-center gap-4">
              {u.avatarUrl ? (
                <img src={u.avatarUrl} alt={u.githubLogin} className="h-8 w-8 rounded-full border border-[#333] flex-shrink-0" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-[#222] border border-[#333] flex-shrink-0 flex items-center justify-center text-xs font-semibold text-white">
                  {u.githubLogin[0]?.toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <span className="text-sm text-white font-medium">@{u.githubLogin}</span>
                <span className="text-xs text-[#888888]"> · last active {daysAgo(u.lastActivity)}</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-sm font-medium text-red-500 tabular-nums">
                  {formatUsd(u.monthlyCost)}/mo
                </span>
                <Badge tone="red">
                  <UserX className="h-3 w-3 mr-1" />
                  No output
                </Badge>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-xl border border-[#222] bg-[#0a0a0a] px-5 py-4 space-y-3">
          <p className="text-sm text-[#cccccc] leading-relaxed">
            Remove these seats in{' '}
            <span className="text-white font-medium">GitHub → Settings → Copilot → Manage seats</span>{' '}
            to stop paying for AI spend that produces no output.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={copyUsernames} className="flex items-center gap-1.5">
              {copied
                ? <><Check className="h-3.5 w-3.5 text-green-400" /> Copied!</>
                : <><Copy className="h-3.5 w-3.5" /> Copy Usernames</>}
            </Button>
            <a
              href="https://github.com/organizations/settings/copilot/seat_management"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] bg-[#111] px-3 py-1.5 text-xs font-medium text-[#888888] hover:text-white hover:border-[#555] transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open GitHub Copilot Settings
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, GitPullRequest, Sparkles, TrendingUp, ArrowRight, Zap, Users, BarChart2, CheckCircle2, Clock, RefreshCw, Crown, Lock } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts'
import { api, type SavingsHistoryResponse } from '../lib/api.js'
import { formatUsd, cn, planDisplayLabel } from '../lib/utils.js'
import { usePlan } from '../lib/plan.js'
import { verdictLabel, verdictEmoji, type Verdict } from '@grassion/shared'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
  StatCard,
} from '../components/ui.js'
import { OnboardingModal } from '../components/OnboardingModal.js'

/* ── helpers ── */
function daysAgo(iso: string | null): string {
  if (!iso) return 'never'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  return `${d}d ago`
}

function buildChartData(
  weekly: Array<{ weekStart: string; totalPrs: number; aiPrs: number }>,
) {
  // Backend returns a 6-week UTC-aligned grid — just format labels
  return weekly.slice(-6).map((w) => {
    const date = new Date(w.weekStart)
    const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    return { week: label, aiPrs: w.aiPrs, totalPrs: w.totalPrs }
  })
}

/* ── ONBOARDING PROGRESS BAR ── */
function OnboardingProgressBar({
  hasRepos,
  totalMergedPrs,
  hasVerdict,
}: {
  hasRepos: boolean
  totalMergedPrs: number
  hasVerdict: boolean
}) {
  const steps = [
    { label: 'Sign in', done: true },
    { label: 'Connect a repo', done: hasRepos },
    { label: 'Merge 5 PRs', done: totalMergedPrs >= 5 },
    { label: 'Get ROI verdict', done: hasVerdict },
  ]
  const allDone = steps.every((s) => s.done)
  if (allDone) {
    localStorage.setItem('onboarding_complete', '1')
    return null
  }
  if (localStorage.getItem('onboarding_complete')) return null
  return (
    <div className="rounded-xl border border-[#222] bg-[#111] px-5 py-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#555]">Getting started</p>
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium',
              step.done
                ? 'border-green-500/30 bg-green-500/10 text-green-400'
                : 'border-[#333] bg-[#0a0a0a] text-[#555]',
            )}>
              {step.done
                ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                : <div className="h-3.5 w-3.5 flex-shrink-0 rounded-full border border-[#444]" />}
              {step.label}
            </div>
            {i < steps.length - 1 && <ArrowRight className="h-3 w-3 flex-shrink-0 text-[#444]" />}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── PAGE ── */
export function DashboardPage() {
  const qc = useQueryClient()
  const summary = useQuery({ queryKey: ['metrics', 'summary'], queryFn: api.metrics.summary })
  const weekly = useQuery({ queryKey: ['metrics', 'weekly'], queryFn: api.metrics.weekly })
  const problemPrs = useQuery({ queryKey: ['prs', 'problem'], queryFn: api.prs.problem })
  const seatWaste = useQuery({ queryKey: ['analytics', 'seat-waste'], queryFn: api.analytics.seatWaste })
  const savingsHistory = useQuery({ queryKey: ['analytics', 'savings-history'], queryFn: api.analytics.savingsHistory })
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.get })
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })
  const { isPaid, isTrial, isTeam, isBusiness, plan } = usePlan()

  const [refreshing, setRefreshing] = useState(false)
  async function refresh() {
    setRefreshing(true)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['metrics'] }),
      qc.invalidateQueries({ queryKey: ['prs'] }),
      qc.invalidateQueries({ queryKey: ['analytics'] }),
      qc.invalidateQueries({ queryKey: ['team'] }),
      qc.invalidateQueries({ queryKey: ['me'] }),
      qc.invalidateQueries({ queryKey: ['analytics', 'savings-history'] }),
    ])
    setTimeout(() => setRefreshing(false), 800)
  }

  const shouldShowOnboarding =
    !localStorage.getItem('grassion_onboarded') &&
    team.data !== undefined &&
    (team.data.monthlyAiSpendUsd === 0 || team.data.monthlyAiSpendUsd === null)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const showOnboarding = shouldShowOnboarding && !onboardingDismissed

  if (summary.isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-32 text-[#888888]">
        <Spinner />
        <span className="text-sm">Loading dashboard…</span>
      </div>
    )
  }

  if (summary.isError) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
        Failed to load metrics. Please refresh.
      </div>
    )
  }

  const data = summary.data!
  console.log('dashboard data:', summary.data, seatWaste.data, weekly.data)
  const sw = seatWaste.data
  const monthlyWaste = sw?.totalMonthlySavings ?? 0
  const chartData = buildChartData(weekly.data ?? [])
  const hasChartData = chartData.some((w) => w.aiPrs > 0 || w.totalPrs > 0)

  const hasRepos = (repos.data?.length ?? 0) > 0
  const totalMergedAllTime = (weekly.data ?? []).reduce((s, w) => s + w.totalPrs, 0)
  const hasVerdict = data.verdict !== 'insufficient_data'
  const showProgressBar = !localStorage.getItem('onboarding_complete')

  return (
    <div className="space-y-5">
      {showOnboarding && (
        <OnboardingModal onClose={() => setOnboardingDismissed(true)} />
      )}

      {/* ── ONBOARDING STEPS ── */}
      {showProgressBar && (
        <OnboardingProgressBar
          hasRepos={hasRepos}
          totalMergedPrs={totalMergedAllTime}
          hasVerdict={hasVerdict}
        />
      )}

      {/* ── PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Dashboard</h1>
          <p className="text-sm text-[#555555] mt-0.5">
            Real-time AI coding ROI for your team
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Plan badge */}
          {plan && (
            <div className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium',
              isTrial
                ? 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400'
                : 'border-white/20 bg-white/5 text-white',
            )}>
              <Crown className="h-3.5 w-3.5" />
              {planDisplayLabel(plan)}
            </div>
          )}
          {/* Refresh button */}
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-[#333] bg-[#111] px-3 py-1.5 text-xs text-[#888888] hover:border-white/20 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh dashboard"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── A: COLLECTING BANNER (subtle, non-blocking) ── */}
      {data.verdict === 'insufficient_data' && (
        <CollectingBanner totalPrs={data.totalPrs} />
      )}

      {/* ── TRIAL UPGRADE PROMPT ── */}
      {isTrial && !isPaid && <TrialBanner />}

      {/* ── A: ROI VERDICT CARD ── */}
      <VerdictBanner
        verdict={data.verdict}
        netDollar={data.netDollar}
        aiPrs={data.aiPrs}
        totalPrs={data.totalPrs}
      />

      {/* ── B: 4 STAT CARDS (always visible, 0 if no data) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Seats" value={sw?.totalSeats ?? 0} sub="active PR authors · 30d" />
        <StatCard label="Active Seats" value={sw?.activeUsers.length ?? 0} sub="AI PR in last 7d" tone="green" />
        <StatCard
          label="Inactive Seats"
          value={sw?.inactiveUsers.length ?? 0}
          sub="no AI usage this week"
          tone={sw && sw.inactiveUsers.length > 0 ? 'red' : 'white'}
        />
        <StatCard
          label="Monthly Waste"
          value={formatUsd(monthlyWaste)}
          sub="from unused AI seats"
          tone={monthlyWaste > 0 ? 'red' : 'white'}
        />
      </div>

      {/* ── SAVINGS UNLOCKED ── */}
      <SavingsUnlockedCard data={savingsHistory.data} loading={savingsHistory.isLoading} isError={savingsHistory.isError} error={savingsHistory.error} />

      {/* ── C: WEEKLY TREND CHART (AreaChart, AI PRs) ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Weekly AI-Assisted PRs</CardTitle>
          <TrendingUp className="h-4 w-4 text-[#555555]" />
        </CardHeader>
        <CardContent>
          {weekly.isLoading ? (
            <div className="flex items-center gap-2 py-12 text-[#888888]">
              <Spinner /> <span className="text-sm">Loading…</span>
            </div>
          ) : (
            <div>
              {/* Legend */}
              <div className="flex items-center gap-5 mb-3">
                <span className="flex items-center gap-1.5 text-xs text-[#555555]">
                  <span className="h-2 w-2 rounded-full bg-green-500" /> AI PRs
                </span>
                <span className="flex items-center gap-1.5 text-xs text-[#555555]">
                  <span className="h-2 w-2 rounded-full bg-[#555555]" /> Total PRs
                </span>
              </div>
              <div className="overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
                <div style={{ minWidth: '380px' }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="aiPrsGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="totalPrsGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#555555" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#555555" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                      <XAxis
                        dataKey="week"
                        tick={{ fontSize: 11, fill: '#555555' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#555555' }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                        width={32}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const row = payload[0]?.payload as { week: string; aiPrs: number; totalPrs: number }
                          return (
                            <div className="rounded-lg border border-[#333] bg-[#111] px-3 py-2 text-xs shadow-xl">
                              <div className="font-medium text-white mb-1.5">{row.week}</div>
                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" />
                                <span className="text-[#888888]"><span className="text-white font-semibold">{row.aiPrs}</span> AI PRs</span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="h-2 w-2 rounded-full bg-[#555555] flex-shrink-0" />
                                <span className="text-[#888888]"><span className="text-white font-semibold">{row.totalPrs}</span> Total PRs</span>
                              </div>
                            </div>
                          )
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="totalPrs"
                        stroke="#555555"
                        strokeWidth={1.5}
                        fill="url(#totalPrsGradient)"
                        dot={false}
                        activeDot={{ r: 3, fill: '#555555', strokeWidth: 0 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="aiPrs"
                        stroke="#22c55e"
                        strokeWidth={2}
                        fill="url(#aiPrsGradient)"
                        dot={false}
                        activeDot={{ r: 4, fill: '#22c55e', strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {!hasChartData && (
                <p className="text-center text-xs text-[#555555] mt-2">
                  Merge AI-assisted PRs to see your weekly trend
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── D: SEAT WASTE SUMMARY TABLE (always visible) ── */}
      <SeatWasteSummary sw={sw} loading={seatWaste.isLoading} />

      {/* ── PROBLEM PRS ── */}
      <ProblemPRsList prs={problemPrs.data ?? []} loading={problemPrs.isLoading} />

      {/* ── TEAM PLAN: PER-DEVELOPER BREAKDOWN ── */}
      {isPaid ? (
        <DeveloperBreakdown sw={seatWaste.data} loading={seatWaste.isLoading} />
      ) : (
        <LockedFeatureCard
          title="Developer Breakdown"
          description="Per-developer AI PR count, adoption rate, and cost — broken down by team member."
          requiredPlan="Pro"
          icon={<Users className="h-5 w-5 text-[#444]" />}
        />
      )}

      {/* ── BUSINESS PLAN: EXECUTIVE REPORT ── */}
      {isPaid ? (
        <ExecutiveReport data={data} monthlyWaste={monthlyWaste} />
      ) : (
        <LockedFeatureCard
          title="Executive Report"
          description="Annual ROI projection, efficiency score, and one-line recommendation."
          requiredPlan="Pro"
          icon={<BarChart2 className="h-5 w-5 text-[#444]" />}
        />
      )}

      <p className="text-xs text-[#444444] pb-4">
        Estimates use a 30% damper on speed savings and assume 3 hours of rework per problem PR.
        Set your AI spend and dev hourly rate in{' '}
        <Link to="/settings" className="text-[#888888] underline hover:text-white">
          Settings
        </Link>{' '}
        for a more accurate verdict.
      </p>
    </div>
  )
}

/* ── COLLECTING BANNER ─────────────────────────────── */
function CollectingBanner({ totalPrs }: { totalPrs: number }) {
  const needed = Math.max(0, 5 - totalPrs)
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#333] bg-[#111] px-4 py-2.5">
      <Clock className="h-4 w-4 text-[#555555] flex-shrink-0" />
      <p className="text-sm text-[#888888]">
        Collecting data —{' '}
        <span className="text-white font-medium">{totalPrs}/5</span> PRs merged this week.
        {needed > 0 && ` Verdict unlocks after ${needed} more.`}
      </p>
    </div>
  )
}

/* ── TRIAL BANNER ─────────────────────────────────── */
function TrialBanner() {
  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="rounded-full bg-yellow-500/15 p-2 flex-shrink-0">
          <Zap className="h-4 w-4 text-yellow-400" />
        </div>
        <div>
          <div className="text-sm font-medium text-white">You're on a free trial</div>
          <div className="text-xs text-[#888888] mt-0.5">
            CSV export and Slack notifications are locked. Upgrade to Pro to unlock all features.
          </div>
        </div>
      </div>
      <Link
        to="/billing"
        className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-[#e5e5e5] transition-colors flex-shrink-0"
      >
        Upgrade to Pro
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}

/* ── VERDICT BANNER ────────────────────────────────── */
function VerdictBanner({
  verdict,
  netDollar,
  aiPrs,
  totalPrs,
}: {
  verdict: Verdict
  netDollar: number
  aiPrs: number
  totalPrs: number
}) {
  type CfgEntry = { border: string; bg: string; valueColor: string; badgeTone: 'green' | 'red' | 'yellow' | 'gray' }
  const fallback: CfgEntry = { border: 'border-[#333]', bg: 'bg-[#111]', valueColor: 'text-white', badgeTone: 'gray' }
  const configs: Record<Verdict, CfgEntry> = {
    net_positive: { border: 'border-green-500/40', bg: 'bg-green-500/5', valueColor: 'text-green-400', badgeTone: 'green' },
    net_negative: { border: 'border-red-500/40', bg: 'bg-red-500/5', valueColor: 'text-red-400', badgeTone: 'red' },
    unclear: { border: 'border-yellow-500/40', bg: 'bg-yellow-500/5', valueColor: 'text-yellow-400', badgeTone: 'yellow' },
    insufficient_data: { border: 'border-[#333]', bg: 'bg-[#111]', valueColor: 'text-[#555555]', badgeTone: 'gray' },
  }
  const cfg: CfgEntry = configs[verdict] ?? fallback
  const aiPct = totalPrs > 0 ? Math.round((aiPrs / totalPrs) * 100) : 0
  const isInsufficient = verdict === 'insufficient_data'
  const isLive = verdict === 'net_positive' || verdict === 'net_negative'

  return (
    <div className="relative">
      {isLive && (
        <div className={cn(
          'absolute inset-0 rounded-xl ring-2 pointer-events-none animate-pulse',
          verdict === 'net_positive' ? 'ring-green-500/40' : 'ring-red-500/40',
        )} />
      )}
      <div className={cn('rounded-xl border px-6 py-5', cfg.border, cfg.bg)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#888888] mb-2">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="uppercase tracking-widest font-medium">ROI Verdict · This Week</span>
          </div>
          <div className="text-2xl sm:text-3xl font-semibold text-white">
            {isInsufficient
              ? 'Awaiting data…'
              : `${verdictEmoji(verdict)} ${verdictLabel(verdict)}`}
          </div>
          <div className="mt-1 text-sm text-[#888888]">
            {isInsufficient
              ? 'Need 5+ merged PRs in a week to compute a verdict'
              : `${aiPrs} AI PRs out of ${totalPrs} total (${aiPct}%)`}
          </div>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2">
          <div className="text-xs text-[#888888]">Estimated net value</div>
          <div className={cn('text-4xl font-bold tabular-nums', cfg.valueColor)}>
            {isInsufficient ? '—' : `${netDollar >= 0 ? '+' : ''}${formatUsd(netDollar)}`}
          </div>
          <Badge tone={cfg.badgeTone}>{isInsufficient ? 'No verdict yet' : verdictLabel(verdict)}</Badge>
        </div>
      </div>
      </div>
    </div>
  )
}

/* ── SEAT WASTE SUMMARY TABLE ──────────────────────── */
function SeatWasteSummary({
  sw,
  loading,
}: {
  sw: { activeUsers: Array<{ githubLogin: string; avatarUrl: string | null; weeklyAiPrs: number; lastActivity: string | null }>; inactiveUsers: Array<{ githubLogin: string; avatarUrl: string | null; lastActivity: string | null; monthlyCost: number }> } | undefined
  loading: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Seat Usage</CardTitle>
        <Link to="/seat-waste" className="text-xs text-[#555555] hover:text-white transition-colors flex items-center gap-1">
          Full report <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#888888]"><Spinner /> Loading…</div>
        ) : !sw || (sw.activeUsers.length + sw.inactiveUsers.length) === 0 ? (
          <div className="py-6 text-center">
            <Users className="mx-auto h-7 w-7 text-[#333] mb-2" />
            <p className="text-sm text-[#555555]">No seat data yet — seat usage appears after PRs are merged.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#111]">
            {[
              ...sw.inactiveUsers.map((u) => ({ ...u, active: false, aiPrs: 0 })),
              ...sw.activeUsers.map((u) => ({ ...u, active: true })),
            ].map((u) => (
              <li key={u.githubLogin} className="flex items-center gap-3 py-2.5">
                {u.avatarUrl ? (
                  <img src={u.avatarUrl} alt="" className="h-8 w-8 rounded-full border border-[#333] flex-shrink-0" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-[#222] border border-[#333] flex-shrink-0 flex items-center justify-center text-xs font-semibold text-white">
                    {u.githubLogin[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', u.active ? 'bg-green-500' : 'bg-red-500')} />
                    <span className="text-sm font-medium text-white truncate">@{u.githubLogin}</span>
                  </div>
                  <div className="text-xs text-[#555555] mt-0.5">
                    {u.active ? `${(u as { weeklyAiPrs?: number }).weeklyAiPrs ?? 0} AI PRs this week` : `Last active ${daysAgo(u.lastActivity)}`}
                  </div>
                </div>
                <Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'Active' : 'Inactive'}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/* ── PROBLEM PRS ───────────────────────────────────── */
function ProblemPRsList({
  prs,
  loading,
}: {
  prs: Array<{
    id: string
    number: number
    title: string
    url: string
    reason: string
    aiSummary: string | null
    aiSource: string | null
    reworkScore: number
  }>
  loading: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Problem PRs</CardTitle>
        <span className="text-xs text-[#555555]">rework score ≥ 30</span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#888888]">
            <Spinner /> Loading…
          </div>
        ) : prs.length === 0 ? (
          <div className="py-4 text-center">
            <CheckCircle2 className="mx-auto h-6 w-6 text-[#333] mb-2" />
            <p className="text-sm text-[#555555]">No problem PRs this week.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#1a1a1a]">
            {prs.map((p) => (
              <li key={p.id} className="py-3.5 flex items-start gap-3">
                <GitPullRequest className="mt-0.5 h-4 w-4 text-[#555555] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-white hover:text-[#ccc] transition-colors text-sm flex items-center gap-1.5"
                  >
                    #{p.number} {p.title}
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  </a>
                  <div className="text-xs text-[#888888] mt-1">{p.aiSummary ?? p.reason}</div>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  {p.aiSource && <Badge tone="blue">{p.aiSource}</Badge>}
                  <span className="text-xs text-[#555555]">score {Math.round(p.reworkScore)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/* ── LOCKED FEATURE CARD ───────────────────────────── */
function LockedFeatureCard({
  title, description, requiredPlan, icon,
}: {
  title: string; description: string; requiredPlan: string; icon: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex-shrink-0">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-[#444]">{title}</span>
              <Lock className="h-3.5 w-3.5 text-[#3a3a3a]" />
            </div>
            <p className="text-xs text-[#3a3a3a]">{description}</p>
          </div>
          <Link
            to="/billing"
            className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[#2a2a2a] px-3 py-1.5 text-xs font-medium text-[#555] hover:text-white hover:border-[#555] transition-colors"
          >
            Upgrade to {requiredPlan}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── DEVELOPER BREAKDOWN (Team+) ───────────────────── */
function DeveloperBreakdown({
  sw,
  loading,
}: {
  sw: { activeUsers: Array<{ githubLogin: string; avatarUrl: string | null; weeklyAiPrs: number; lastActivity: string | null }>; inactiveUsers: Array<{ githubLogin: string; avatarUrl: string | null; lastActivity: string | null; monthlyCost: number }> } | undefined
  loading: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Developer Breakdown</CardTitle>
        <Badge tone="blue">Team</Badge>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#888888]"><Spinner /> Loading…</div>
        ) : !sw || (sw.activeUsers.length + sw.inactiveUsers.length) === 0 ? (
          <p className="text-sm text-[#555555] py-4 text-center">No developer data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-widest text-[#555555]">Developer</th>
                  <th className="text-right py-2 pr-4 text-xs font-medium uppercase tracking-widest text-[#555555]">AI PRs / wk</th>
                  <th className="text-right py-2 pr-4 text-xs font-medium uppercase tracking-widest text-[#555555]">Status</th>
                  <th className="text-right py-2 text-xs font-medium uppercase tracking-widest text-[#555555]">Wasted $/mo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#111]">
                {sw.activeUsers.map((u) => (
                  <tr key={u.githubLogin}>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        {u.avatarUrl
                          ? <img src={u.avatarUrl} alt="" className="h-6 w-6 rounded-full border border-[#333]" />
                          : <div className="h-6 w-6 rounded-full bg-[#222] border border-[#333] flex items-center justify-center text-[10px] font-semibold text-white">{u.githubLogin[0]?.toUpperCase()}</div>}
                        <span className="text-white">@{u.githubLogin}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-white">{u.weeklyAiPrs}</td>
                    <td className="py-2.5 pr-4 text-right"><Badge tone="green">Active</Badge></td>
                    <td className="py-2.5 text-right text-[#555555]">—</td>
                  </tr>
                ))}
                {sw.inactiveUsers.map((u) => (
                  <tr key={u.githubLogin}>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        {u.avatarUrl
                          ? <img src={u.avatarUrl} alt="" className="h-6 w-6 rounded-full border border-[#333]" />
                          : <div className="h-6 w-6 rounded-full bg-[#222] border border-[#333] flex items-center justify-center text-[10px] font-semibold text-white">{u.githubLogin[0]?.toUpperCase()}</div>}
                        <span className="text-[#555555]">@{u.githubLogin}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-[#555555]">0</td>
                    <td className="py-2.5 pr-4 text-right"><Badge tone="red">Inactive</Badge></td>
                    <td className="py-2.5 text-right text-red-500 tabular-nums">${u.monthlyCost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── SAVINGS UNLOCKED ──────────────────────────────── */
function SavingsUnlockedCard({
  data,
  loading,
  isError,
  error,
}: {
  data: SavingsHistoryResponse | undefined
  loading: boolean
  isError?: boolean
  error?: unknown
}) {
  console.log('savings data:', data, 'loading:', loading, 'isError:', isError, 'error:', error)
  const hasSavings = data && data.totalWasteIdentified > 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Savings Unlocked by Grassion</CardTitle>
          <p className="text-xs text-[#555555] mt-0.5">Running total of waste identified since you connected</p>
        </div>
        <Link
          to="/seat-waste"
          className="text-xs text-[#555555] hover:text-white transition-colors flex items-center gap-1"
        >
          Seat details <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#888888]"><Spinner /> Loading…</div>
        ) : isError ? (
          <div className="py-6 text-center">
            <p className="text-sm text-[#ef4444]">Failed to load savings data — check console for details.</p>
          </div>
        ) : !hasSavings ? (
          <div className="py-6 text-center">
            <Sparkles className="mx-auto h-7 w-7 text-[#333] mb-2" />
            <p className="text-sm text-[#555555]">No waste detected yet — savings appear once inactive seats are identified.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Summary row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-green-500/20 bg-green-500/5 px-4 py-3">
                <div className="text-xs text-[#888888] mb-1">Identified since joining</div>
                <div className="text-2xl font-bold text-green-400 tabular-nums">
                  {formatUsd(data.totalWasteIdentified)}
                </div>
                <div className="text-xs text-[#555555] mt-0.5">in potential waste found</div>
              </div>
              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
                <div className="text-xs text-[#888888] mb-1">This month's exposure</div>
                <div className="text-2xl font-bold text-yellow-400 tabular-nums">
                  {formatUsd(data.thisMonthWaste)}
                </div>
                <div className="text-xs text-[#555555] mt-0.5">act now to reclaim this</div>
              </div>
            </div>

            {/* Bar chart */}
            {data.monthlyHistory.length > 1 && (
              <div>
                <div className="text-xs text-[#555555] mb-3 uppercase tracking-wider font-medium">Monthly waste identified</div>
                <div className="overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
                  <div style={{ minWidth: '380px' }}>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={data.monthlyHistory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 11, fill: '#555555' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#555555' }}
                          axisLine={false}
                          tickLine={false}
                          width={48}
                          tickFormatter={(v: number) => `$${v}`}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            const row = payload[0]?.payload as { month: string; wasteUsd: number }
                            return (
                              <div className="rounded-lg border border-[#333] bg-[#111] px-3 py-2 text-xs shadow-xl">
                                <div className="font-medium text-white mb-1">{row.month}</div>
                                <div className="text-[#888888]">
                                  Waste identified: <span className="text-red-400 font-semibold">{formatUsd(row.wasteUsd)}</span>
                                </div>
                              </div>
                            )
                          }}
                        />
                        <Bar dataKey="wasteUsd" radius={[4, 4, 0, 0]}>
                          {data.monthlyHistory.map((entry, index) => (
                            <Cell
                              key={index}
                              fill={entry.wasteUsd > 0 ? '#ef4444' : '#1a1a1a'}
                              fillOpacity={0.8}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* CTA */}
            <div className="flex items-center gap-3 rounded-lg border border-[#222] bg-[#0a0a0a] px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#888888]">
                  Remove inactive seats in{' '}
                  <a
                    href="https://github.com/organizations/settings/copilot/seat_management"
                    target="_blank"
                    rel="noreferrer"
                    className="text-white underline hover:text-[#ccc] transition-colors"
                  >
                    GitHub Copilot Settings
                  </a>{' '}
                  to stop paying for unused licenses.
                </p>
              </div>
              <Link
                to="/seat-waste"
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-[#e5e5e5] transition-colors"
              >
                View seats
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── EXECUTIVE REPORT (Business+) ──────────────────── */
function ExecutiveReport({
  data,
  monthlyWaste,
}: {
  data: { netDollar: number; aiPrs: number; totalPrs: number; monthlySpend: number; speedDeltaPercent: number; reworkMultiplier: number; verdict: string }
  monthlyWaste: number
}) {
  const adoptionRate = data.totalPrs > 0 ? Math.round((data.aiPrs / data.totalPrs) * 100) : 0
  const annualProjection = data.netDollar * 52
  const weeklySpend = data.monthlySpend / 4
  const roiMultiple = weeklySpend > 0 ? data.netDollar / weeklySpend : null

  let recommendation = ''
  if (data.verdict === 'net_positive') {
    recommendation = 'AI tools are delivering strong ROI. Consider expanding to more developers.'
  } else if (data.verdict === 'net_negative') {
    recommendation = 'ROI is negative. Review inactive seats and consider reducing licenses.'
  } else if (data.verdict === 'insufficient_data') {
    recommendation = 'Connect more repos and wait for 2+ weeks of PR data for full analysis.'
  } else {
    recommendation = monthlyWaste > 200
      ? `${formatUsd(monthlyWaste)}/month in unused seats — reallocate or downgrade inactive members.`
      : 'AI coding tools are delivering measurable ROI. Maintain current adoption pace.'
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Executive Report</CardTitle>
        <Badge tone="gray">Business</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          {[
            { label: 'AI Adoption', value: `${adoptionRate}%`, sub: 'of all PRs are AI-assisted' },
            { label: 'Annual Projection', value: `${annualProjection >= 0 ? '+' : ''}${formatUsd(annualProjection)}`, sub: 'estimated annual net value' },
            { label: 'ROI Multiple', value: roiMultiple !== null ? `${roiMultiple.toFixed(1)}×` : '—', sub: 'weekly net value ÷ weekly AI cost' },
          ].map((item) => (
            <div key={item.label} className="rounded-lg bg-[#0a0a0a] border border-[#222] px-4 py-3">
              <div className="text-xs text-[#555555] uppercase tracking-widest mb-1">{item.label}</div>
              <div className="text-2xl font-semibold text-white tabular-nums">{item.value}</div>
              <div className="text-xs text-[#555555] mt-0.5">{item.sub}</div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-[#222] bg-[#0a0a0a] px-4 py-3">
          <div className="text-xs text-[#555555] uppercase tracking-widest mb-1.5">Recommendation</div>
          <p className="text-sm text-white">{recommendation}</p>
        </div>
      </CardContent>
    </Card>
  )
}

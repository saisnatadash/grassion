import { useQuery } from '@tanstack/react-query'
import { ExternalLink, GitPullRequest, Sparkles, TrendingUp, ArrowRight, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { api } from '../lib/api.js'
import { formatUsd, cn } from '../lib/utils.js'
import { usePlan } from '../lib/plan.js'
import { verdictLabel, verdictEmoji, type Verdict } from '@grassion/shared'
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
  StatCard,
} from '../components/ui.js'

export function DashboardPage() {
  const summary = useQuery({ queryKey: ['metrics', 'summary'], queryFn: api.metrics.summary })
  const weekly = useQuery({ queryKey: ['metrics', 'weekly'], queryFn: api.metrics.weekly })
  const problemPrs = useQuery({ queryKey: ['prs', 'problem'], queryFn: api.prs.problem })
  const seatWaste = useQuery({ queryKey: ['analytics', 'seat-waste'], queryFn: api.analytics.seatWaste })
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.get })
  const { isPaid, isTrial } = usePlan()

  if (summary.isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-32 text-[#888888]">
        <Spinner />
        <span className="text-sm">Loading dashboard…</span>
      </div>
    )
  }

  if (summary.isError) {
    return <Alert tone="red">Failed to load metrics. Please refresh.</Alert>
  }

  const data = summary.data!

  if (data.verdict === 'insufficient_data') {
    return <EmptyState totalPrs={data.totalPrs} />
  }

  const sw = seatWaste.data
  const monthlyWaste = sw?.totalMonthlySavings ?? 0

  return (
    <div className="space-y-6">

      {/* ── ROI VERDICT BANNER ── */}
      <VerdictBanner verdict={data.verdict} netDollar={data.netDollar} aiPrs={data.aiPrs} totalPrs={data.totalPrs} />

      {/* ── TRIAL UPGRADE PROMPT ── */}
      {isTrial && !isPaid && <TrialBanner />}

      {/* ── 4 STAT CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Seats"
          value={sw?.totalSeats ?? '—'}
          sub="active PR authors · 30d"
        />
        <StatCard
          label="Active Seats"
          value={sw?.activeUsers.length ?? '—'}
          sub="AI PR in last 7d"
          tone="green"
        />
        <StatCard
          label="Inactive Seats"
          value={sw?.inactiveUsers.length ?? '—'}
          sub="no AI usage this week"
          tone={sw && sw.inactiveUsers.length > 0 ? 'red' : 'white'}
        />
        <StatCard
          label="Monthly Waste"
          value={formatUsd(monthlyWaste)}
          sub="unused AI seats"
          tone={monthlyWaste > 0 ? 'red' : 'white'}
        />
      </div>

      {/* ── METRICS ROW ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="AI Merge Speed"
          value={`${data.speedDeltaPercent > 0 ? '+' : ''}${data.speedDeltaPercent}%`}
          sub="vs human PRs"
          tone={data.speedDeltaPercent > 0 ? 'green' : 'red'}
        />
        <StatCard
          label="AI Rework Rate"
          value={`${data.reworkMultiplier}×`}
          sub="multiplier vs humans"
          tone={data.reworkMultiplier < 1.2 ? 'green' : 'red'}
        />
        <StatCard
          label="AI Spend"
          value={formatUsd(data.monthlySpend)}
          sub={`${team.data?.avgDevHourlyRateUsd ?? 75} $/hr dev rate`}
        />
      </div>

      {/* ── WEEKLY TREND CHART ── */}
      <WeeklyTrendCard data={weekly.data ?? []} loading={weekly.isLoading} />

      {/* ── PROBLEM PRS ── */}
      <ProblemPRsList prs={problemPrs.data ?? []} loading={problemPrs.isLoading} />

      <p className="text-xs text-[#555555] pb-4">
        Estimates use a 30% damper on speed savings and assume 3 hours of rework per problem PR.
        Adjust your AI spend and dev hourly rate in{' '}
        <Link to="/settings" className="text-[#888888] underline hover:text-white">
          Settings
        </Link>{' '}
        for a more accurate verdict.
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
        className="inline-flex items-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-black hover:bg-yellow-400 transition-colors flex-shrink-0"
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
  const configs = {
    net_positive: {
      border: 'border-green-500/40',
      bg: 'bg-green-500/5',
      valueColor: 'text-green-500',
      badgeTone: 'green' as const,
    },
    net_negative: {
      border: 'border-red-500/40',
      bg: 'bg-red-500/5',
      valueColor: 'text-red-500',
      badgeTone: 'red' as const,
    },
    neutral: {
      border: 'border-yellow-500/40',
      bg: 'bg-yellow-500/5',
      valueColor: 'text-yellow-400',
      badgeTone: 'yellow' as const,
    },
    unclear: {
      border: 'border-[#333]',
      bg: 'bg-white/2',
      valueColor: 'text-white',
      badgeTone: 'gray' as const,
    },
    insufficient_data: {
      border: 'border-[#333]',
      bg: 'bg-white/2',
      valueColor: 'text-white',
      badgeTone: 'gray' as const,
    },
  }
  const cfg = configs[verdict] ?? configs.unclear
  const aiPct = totalPrs > 0 ? Math.round((aiPrs / totalPrs) * 100) : 0

  return (
    <div className={cn('rounded-xl border px-6 py-5', cfg.border, cfg.bg)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#888888] mb-2">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="uppercase tracking-widest font-medium">ROI Verdict · This Week</span>
          </div>
          <div className="text-2xl sm:text-3xl font-semibold text-white">
            {verdictEmoji(verdict)}&nbsp;{verdictLabel(verdict)}
          </div>
          <div className="mt-1 text-sm text-[#888888]">
            {aiPrs} AI PRs out of {totalPrs} total ({aiPct}%)
          </div>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2">
          <div className="text-xs text-[#888888]">Estimated net value</div>
          <div className={cn('text-4xl font-bold tabular-nums', cfg.valueColor)}>
            {netDollar >= 0 ? '+' : ''}{formatUsd(netDollar)}
          </div>
          <Badge tone={cfg.badgeTone}>{verdictLabel(verdict)}</Badge>
        </div>
      </div>
    </div>
  )
}

/* ── WEEKLY TREND CHART ────────────────────────────── */
function WeeklyTrendCard({
  data,
  loading,
}: {
  data: Array<{ weekStart: string; netDollar: number; aiPrs: number; totalPrs: number }>
  loading: boolean
}) {
  const chartData = data
    .slice(-12)
    .map((w) => ({
      ...w,
      week: new Date(w.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }))
  const allZero = chartData.every((w) => w.netDollar === 0 && w.totalPrs === 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>12-Week Trend</CardTitle>
        <TrendingUp className="h-4 w-4 text-[#555555]" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[#888888]">
            <Spinner /> <span className="text-sm">Loading…</span>
          </div>
        ) : allZero ? (
          <div className="py-12 text-center">
            <p className="text-sm text-[#555555]">
              Trend will populate after 2+ weeks of PR activity.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
                tickFormatter={(v: number) => `$${v}`}
                width={52}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0]?.payload as {
                    week: string
                    netDollar: number
                    aiPrs: number
                  }
                  return (
                    <div className="rounded-lg border border-[#333] bg-[#111] px-3 py-2 text-xs shadow-xl">
                      <div className="font-medium text-white mb-1">{row.week}</div>
                      <div className={cn(row.netDollar >= 0 ? 'text-green-500' : 'text-red-500')}>
                        Net {row.netDollar >= 0 ? '+' : ''}{formatUsd(row.netDollar)}
                      </div>
                      <div className="text-[#888888]">{row.aiPrs} AI PRs</div>
                    </div>
                  )
                }}
              />
              <Line
                type="monotone"
                dataKey="netDollar"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#22c55e', strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
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
          <div className="py-4 text-center text-sm text-[#555555]">
            No problem PRs this week.
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
                    className="font-medium text-white hover:text-green-400 transition-colors text-sm flex items-center gap-1.5"
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

/* ── EMPTY STATE ───────────────────────────────────── */
function EmptyState({ totalPrs }: { totalPrs: number }) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#222222] bg-[#111111] px-8 py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 border border-green-500/20">
          <GitPullRequest className="h-6 w-6 text-green-500" />
        </div>
        <h2 className="text-xl font-semibold text-white">Connect your first repo to see ROI data</h2>
        <p className="mt-2 text-sm text-[#888888] max-w-md mx-auto">
          Grassion needs at least 5 merged PRs in a week to compute a verdict.
          {totalPrs > 0 && ` You have ${totalPrs} so far — keep going.`}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 rounded-lg bg-green-500 px-5 py-2.5 text-sm font-semibold text-black hover:bg-green-400 transition-colors"
          >
            Connect Repository
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/seat-waste"
            className="inline-flex items-center gap-2 rounded-lg border border-[#333] px-5 py-2.5 text-sm font-medium text-[#888888] hover:text-white hover:border-[#555] transition-colors"
          >
            View Seat Waste
          </Link>
        </div>
      </div>
    </div>
  )
}

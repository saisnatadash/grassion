import { useQuery } from '@tanstack/react-query'
import { ExternalLink, GitPullRequest, Sparkles, TrendingUp, ArrowRight, Zap, Users, Lock, BarChart2 } from 'lucide-react'
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
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })
  const { isPaid, isTrial, isTeam, isBusiness, plan } = usePlan()

  if (summary.isLoading || repos.isLoading) {
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
  const activeRepos = (repos.data ?? []).filter((r) => r.isActive)

  if (data.verdict === 'insufficient_data') {
    return <EmptyState totalPrs={data.totalPrs} hasRepos={activeRepos.length > 0} />
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

      {/* ── TEAM PLAN: PER-DEVELOPER BREAKDOWN ── */}
      {isTeam ? (
        <DeveloperBreakdown sw={seatWaste.data} loading={seatWaste.isLoading} />
      ) : isPaid ? (
        <LockedFeatureCard
          title="Developer Breakdown"
          description="See per-developer AI PR count, adoption rate, and seat waste — broken down by team member."
          requiredPlan="Team"
          icon={<Users className="h-5 w-5 text-[#555555]" />}
        />
      ) : null}

      {/* ── BUSINESS PLAN: EXECUTIVE REPORT ── */}
      {isBusiness ? (
        <ExecutiveReport data={data} monthlyWaste={sw?.totalMonthlySavings ?? 0} />
      ) : isPaid ? (
        <LockedFeatureCard
          title="Executive Report"
          description="Annual ROI projection, efficiency score, and one-line recommendation for your leadership team."
          requiredPlan="Business"
          icon={<BarChart2 className="h-5 w-5 text-[#555555]" />}
        />
      ) : null}

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
                      <div className={cn(row.netDollar >= 0 ? 'text-white' : 'text-red-500')}>
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
                stroke="#ffffff"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#ffffff', strokeWidth: 0 }}
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
  title,
  description,
  requiredPlan,
  icon,
}: {
  title: string
  description: string
  requiredPlan: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="py-6">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex-shrink-0">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-[#555555]">{title}</span>
              <Lock className="h-3.5 w-3.5 text-[#444444]" />
            </div>
            <p className="text-xs text-[#444444]">{description}</p>
          </div>
          <Link
            to="/billing"
            className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-1.5 text-xs font-medium text-[#888888] hover:text-white hover:border-[#555] transition-colors"
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
          <p className="text-sm text-[#555555] py-4 text-center">No developer data yet — merge some PRs first.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  <th className="text-left py-2 text-xs font-medium uppercase tracking-widest text-[#555555]">Developer</th>
                  <th className="text-right py-2 text-xs font-medium uppercase tracking-widest text-[#555555]">AI PRs / week</th>
                  <th className="text-right py-2 text-xs font-medium uppercase tracking-widest text-[#555555]">Status</th>
                  <th className="text-right py-2 text-xs font-medium uppercase tracking-widest text-[#555555]">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#111]">
                {sw.activeUsers.map((u) => (
                  <tr key={u.githubLogin}>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} alt="" className="h-6 w-6 rounded-full border border-[#333]" />
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-[#222] border border-[#333] flex items-center justify-center text-[10px] font-semibold text-white">
                            {u.githubLogin[0]?.toUpperCase()}
                          </div>
                        )}
                        <span className="text-white font-medium">@{u.githubLogin}</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-white">{u.weeklyAiPrs}</td>
                    <td className="py-2.5 text-right"><Badge tone="green">Active</Badge></td>
                    <td className="py-2.5 text-right text-[#555555]">—</td>
                  </tr>
                ))}
                {sw.inactiveUsers.map((u) => (
                  <tr key={u.githubLogin}>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} alt="" className="h-6 w-6 rounded-full border border-[#333]" />
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-[#222] border border-[#333] flex items-center justify-center text-[10px] font-semibold text-white">
                            {u.githubLogin[0]?.toUpperCase()}
                          </div>
                        )}
                        <span className="text-[#555555]">@{u.githubLogin}</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-[#555555]">0</td>
                    <td className="py-2.5 text-right"><Badge tone="red">Inactive</Badge></td>
                    <td className="py-2.5 text-right text-red-500 tabular-nums">${u.monthlyCost}/mo</td>
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

/* ── EXECUTIVE REPORT (Business+) ──────────────────── */
function ExecutiveReport({
  data,
  monthlyWaste,
}: {
  data: { netDollar: number; aiPrs: number; totalPrs: number; monthlySpend: number; speedDeltaPercent: number; reworkMultiplier: number }
  monthlyWaste: number
}) {
  const adoptionRate = data.totalPrs > 0 ? Math.round((data.aiPrs / data.totalPrs) * 100) : 0
  const annualProjection = data.netDollar * 52
  const efficiency = data.monthlySpend > 0
    ? Math.round((data.netDollar / data.monthlySpend) * 100)
    : null
  let recommendation = ''
  if (adoptionRate < 30) recommendation = `Low AI adoption (${adoptionRate}%) — consider re-onboarding developers on AI tools.`
  else if (data.reworkMultiplier > 1.5) recommendation = `High rework rate (${data.reworkMultiplier}×) — review problem PRs and tighten AI review process.`
  else if (monthlyWaste > 200) recommendation = `$${monthlyWaste}/month in unused AI seats — reallocate or downgrade inactive members.`
  else recommendation = `AI coding tools are delivering measurable ROI. Maintain current adoption pace.`

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Executive Report</CardTitle>
        <Badge tone="gray">Business</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          <div className="rounded-lg bg-[#0a0a0a] border border-[#222] px-4 py-3">
            <div className="text-xs text-[#555555] uppercase tracking-widest mb-1">AI Adoption</div>
            <div className="text-2xl font-semibold text-white tabular-nums">{adoptionRate}%</div>
            <div className="text-xs text-[#555555] mt-0.5">of all PRs are AI-assisted</div>
          </div>
          <div className="rounded-lg bg-[#0a0a0a] border border-[#222] px-4 py-3">
            <div className="text-xs text-[#555555] uppercase tracking-widest mb-1">Annual Projection</div>
            <div className={cn('text-2xl font-semibold tabular-nums', annualProjection >= 0 ? 'text-white' : 'text-red-500')}>
              {annualProjection >= 0 ? '+' : ''}{formatUsd(annualProjection)}
            </div>
            <div className="text-xs text-[#555555] mt-0.5">estimated annual net value</div>
          </div>
          <div className="rounded-lg bg-[#0a0a0a] border border-[#222] px-4 py-3">
            <div className="text-xs text-[#555555] uppercase tracking-widest mb-1">ROI Efficiency</div>
            <div className="text-2xl font-semibold text-white tabular-nums">
              {efficiency !== null ? `${efficiency}%` : '—'}
            </div>
            <div className="text-xs text-[#555555] mt-0.5">net value ÷ AI spend</div>
          </div>
        </div>
        <div className="rounded-lg border border-[#222] bg-[#0a0a0a] px-4 py-3">
          <div className="text-xs text-[#555555] uppercase tracking-widest mb-1.5">Recommendation</div>
          <p className="text-sm text-white">{recommendation}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── EMPTY STATE ───────────────────────────────────── */
function EmptyState({ totalPrs, hasRepos }: { totalPrs: number; hasRepos: boolean }) {
  const prsNeeded = Math.max(0, 5 - totalPrs)

  if (!hasRepos) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-[#222222] bg-[#111111] px-8 py-14 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/5 border border-[#333]">
            <GitPullRequest className="h-6 w-6 text-[#888888]" />
          </div>
          <h2 className="text-xl font-semibold text-white">No repositories connected yet</h2>
          <p className="mt-2 text-sm text-[#888888] max-w-md mx-auto">
            Install the Grassion GitHub App on your repos so we can track PRs and measure your AI ROI.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="https://github.com/apps/grassion/installations/new"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-[#e5e5e5] transition-colors"
            >
              Install GitHub App
              <ArrowRight className="h-4 w-4" />
            </a>
            <Link
              to="/settings"
              className="inline-flex items-center gap-2 rounded-lg border border-[#333] px-5 py-2.5 text-sm font-medium text-[#888888] hover:text-white hover:border-[#555] transition-colors"
            >
              Go to Settings
            </Link>
          </div>
        </div>
        <OnboardingChecklist step={1} totalPrs={0} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#222222] bg-[#111111] px-8 py-14 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/5 border border-[#333]">
          <GitPullRequest className="h-6 w-6 text-[#888888]" />
        </div>
        <h2 className="text-xl font-semibold text-white">
          {totalPrs === 0
            ? 'Waiting for your first merged PR'
            : `${prsNeeded} more PR${prsNeeded === 1 ? '' : 's'} until your first verdict`}
        </h2>
        <p className="mt-2 text-sm text-[#888888] max-w-md mx-auto">
          {totalPrs === 0
            ? 'Grassion is connected and watching. Once a developer merges a PR, we start tracking.'
            : `You have ${totalPrs} merged PR${totalPrs === 1 ? '' : 's'} so far. Grassion needs 5 in a week to compute your first ROI verdict.`}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/seat-waste"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-[#e5e5e5] transition-colors"
          >
            View Seat Waste
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 rounded-lg border border-[#333] px-5 py-2.5 text-sm font-medium text-[#888888] hover:text-white hover:border-[#555] transition-colors"
          >
            Settings
          </Link>
        </div>
      </div>
      <OnboardingChecklist step={totalPrs === 0 ? 2 : 3} totalPrs={totalPrs} />
    </div>
  )
}

/* ── ONBOARDING CHECKLIST ──────────────────────────── */
function OnboardingChecklist({ step, totalPrs }: { step: number; totalPrs: number }) {
  const steps = [
    {
      n: 1,
      title: 'Install GitHub App',
      desc: 'Connect Grassion to your repositories from the Settings page.',
      done: step > 1,
    },
    {
      n: 2,
      title: 'Merge your first PR',
      desc: 'Grassion watches every merged PR and detects whether it was AI-assisted.',
      done: step > 2,
    },
    {
      n: 3,
      title: 'Reach 5 merged PRs',
      desc: `${totalPrs}/5 PRs merged. Your ROI verdict unlocks after 5 merges in a week.`,
      done: false,
    },
    {
      n: 4,
      title: 'Read your ROI verdict',
      desc: 'See net dollar value, speed delta, rework rate, and seat waste — all in one view.',
      done: false,
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Getting started</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-4">
          {steps.map((s) => (
            <li key={s.n} className="flex items-start gap-3">
              <div
                className={cn(
                  'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  s.done
                    ? 'bg-white text-black'
                    : s.n === step
                      ? 'bg-white/10 border border-white/30 text-white'
                      : 'bg-[#1a1a1a] border border-[#333] text-[#555555]',
                )}
              >
                {s.done ? '✓' : s.n}
              </div>
              <div>
                <div
                  className={cn(
                    'text-sm font-medium',
                    s.done ? 'text-[#555555] line-through' : s.n === step ? 'text-white' : 'text-[#555555]',
                  )}
                >
                  {s.title}
                </div>
                <div className="text-xs text-[#555555] mt-0.5">{s.desc}</div>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

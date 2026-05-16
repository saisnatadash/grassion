import { useQuery } from '@tanstack/react-query'
import { ExternalLink, GitPullRequest, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api.js'
import { formatUsd, cn } from '../lib/utils.js'
import { verdictLabel, verdictEmoji, type Verdict } from '@grassion/shared'
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'

export function DashboardPage() {
  const summary = useQuery({ queryKey: ['metrics', 'summary'], queryFn: api.metrics.summary })
  const weekly = useQuery({ queryKey: ['metrics', 'weekly'], queryFn: api.metrics.weekly })
  const problemPrs = useQuery({ queryKey: ['prs', 'problem'], queryFn: api.prs.problem })
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.get })

  if (summary.isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-neutral-500">
        <Spinner /> <span className="ml-2">Loading dashboard…</span>
      </div>
    )
  }

  if (summary.isError) {
    return <Alert tone="red">Failed to load metrics. Please refresh.</Alert>
  }

  const data = summary.data!
  if (data.verdict === 'insufficient_data') {
    return <InsufficientDataState totalPrs={data.totalPrs} />
  }

  return (
    <div className="space-y-6">
      <VerdictBadge verdict={data.verdict} netDollar={data.netDollar} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="AI merge speed"
          value={`${data.speedDeltaPercent > 0 ? '+' : ''}${data.speedDeltaPercent}%`}
          sub="faster than human PRs"
          good={data.speedDeltaPercent > 0}
        />
        <StatCard
          label="AI rework rate"
          value={`${data.reworkMultiplier}×`}
          sub="vs human PRs"
          good={data.reworkMultiplier < 1.2}
        />
        <StatCard
          label="AI spend"
          value={formatUsd(data.monthlySpend)}
          sub={`per month — ${team.data?.avgDevHourlyRateUsd ?? 75} $/hr dev rate`}
        />
        <StatCard
          label="AI PRs shipped"
          value={`${data.aiPrs}/${data.totalPrs}`}
          sub={`${data.totalPrs > 0 ? Math.round((data.aiPrs / data.totalPrs) * 100) : 0}% of total`}
        />
      </div>

      <WeeklyTrendCard data={weekly.data ?? []} loading={weekly.isLoading} />

      <ProblemPRsList prs={problemPrs.data ?? []} loading={problemPrs.isLoading} />

      <p className="text-xs text-neutral-500">
        Estimates use a 30% damper on speed savings and assume 3 hours of rework per problem PR. Adjust your
        AI spend and dev hourly rate in <Link to="/settings" className="underline">Settings</Link> for a more
        accurate verdict.
      </p>
    </div>
  )
}

function VerdictBadge({ verdict, netDollar }: { verdict: Verdict; netDollar: number }) {
  const tone = verdict === 'net_positive' ? 'green' : verdict === 'net_negative' ? 'red' : 'yellow'
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Sparkles className="h-4 w-4" /> Verdict for this week
          </div>
          <div className="mt-1 text-3xl font-semibold">
            {verdictEmoji(verdict)} {verdictLabel(verdict)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-neutral-500">Estimated net</div>
          <div
            className={cn(
              'text-3xl font-semibold tabular-nums',
              netDollar > 0 && 'text-green-700',
              netDollar < 0 && 'text-red-700',
            )}
          >
            {netDollar >= 0 ? '+' : ''}
            {formatUsd(netDollar)}
          </div>
        </div>
        <Badge tone={tone} className="hidden md:inline-flex">
          {verdictLabel(verdict)}
        </Badge>
      </CardContent>
    </Card>
  )
}

function StatCard({
  label,
  value,
  sub,
  good,
}: {
  label: string
  value: string
  sub: string
  good?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
        <div
          className={cn(
            'mt-1 text-2xl font-semibold tabular-nums',
            good === true && 'text-green-700',
            good === false && 'text-red-700',
          )}
        >
          {value}
        </div>
        <div className="mt-1 text-xs text-neutral-500">{sub}</div>
      </CardContent>
    </Card>
  )
}

function formatWeekLabel(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
}

function WeeklyTrendCard({
  data,
  loading,
}: {
  data: Array<{ weekStart: string; netDollar: number; aiPrs: number }>
  loading: boolean
}) {
  const allZero = data.every((w) => w.netDollar === 0)
  const chartData = data.map((w) => ({ ...w, week: formatWeekLabel(w.weekStart) }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>12-Week Trend</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-500 py-8 justify-center">
            <Spinner /> Loading trend…
          </div>
        ) : allZero ? (
          <p className="text-sm text-neutral-400 py-8 text-center">
            Trend will populate after 2+ weeks of data
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16a34a" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="week"
                tick={{ fontSize: 11, fill: '#737373' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#737373' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${v}`}
                width={48}
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
                    <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs shadow-sm">
                      <div className="font-medium text-neutral-700">{row.week}</div>
                      <div className={cn('mt-1', row.netDollar >= 0 ? 'text-green-700' : 'text-red-700')}>
                        Net {row.netDollar >= 0 ? '+' : ''}{formatUsd(row.netDollar)}
                      </div>
                      <div className="text-neutral-500">{row.aiPrs} AI PRs</div>
                    </div>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey="netDollar"
                stroke="#16a34a"
                strokeWidth={2}
                fill="url(#netFill)"
                dot={false}
                activeDot={{ r: 4, fill: '#16a34a' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

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
        <CardTitle>Problem PRs worth reviewing</CardTitle>
        <span className="text-xs text-neutral-500">High rework score (≥30)</span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-neutral-500 flex items-center gap-2">
            <Spinner /> Loading…
          </div>
        ) : prs.length === 0 ? (
          <div className="text-sm text-neutral-500">No problem PRs detected this week. Nice.</div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {prs.map((p) => (
              <li key={p.id} className="py-3 flex items-start gap-3">
                <GitPullRequest className="mt-1 h-4 w-4 text-neutral-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-neutral-900 hover:underline truncate block"
                  >
                    #{p.number} {p.title} <ExternalLink className="inline h-3 w-3" />
                  </a>
                  <div className="text-sm text-neutral-700 mt-0.5">{p.aiSummary ?? p.reason}</div>
                  {p.aiSummary && p.reason && p.reason !== p.aiSummary && (
                    <div className="text-xs text-neutral-400 mt-0.5">Signals: {p.reason}</div>
                  )}
                </div>
                <div className="text-right">
                  {p.aiSource && <Badge tone="blue">{p.aiSource}</Badge>}
                  <div className="mt-1 text-xs text-neutral-500">score {Math.round(p.reworkScore)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function InsufficientDataState({ totalPrs }: { totalPrs: number }) {
  return (
    <div className="space-y-6">
      <Alert tone="blue">
        Not enough data yet — we need at least 5 merged PRs in a week to compute a reliable verdict.
        Currently: {totalPrs} merged this week.
      </Alert>
      <Card>
        <CardContent className="p-8 text-center">
          <h2 className="text-xl font-semibold">Hang tight — we're still listening</h2>
          <p className="mt-2 text-neutral-600 text-sm">
            Once your team merges a few more PRs, your dashboard will populate automatically. AI detection
            runs on every PR via webhook, and outcomes settle 7 days after merge.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link to="/settings">
              <Button variant="secondary">Adjust settings</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

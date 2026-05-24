import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Activity, AlertTriangle, ArrowRight, Users,
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import { api, type HealthDevRow, type HealthResponse, type OutcomesResponse } from '../lib/api.js'
import { formatUsd, cn } from '../lib/utils.js'
import { Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'

/* ── helpers ── */
const TOOL_NAMES: Record<string, string> = {
  copilot: 'GitHub Copilot',
  cursor: 'Cursor',
  'claude-code': 'Claude Code',
  codeium: 'Codeium',
  tabnine: 'Tabnine',
  windsurf: 'Windsurf',
  'ai-assisted': 'AI-Assisted',
}

function toolName(key: string): string { return TOOL_NAMES[key] ?? key }

function scoreColor(s: number): string {
  return s >= 75 ? 'text-green-400' : s >= 50 ? 'text-yellow-400' : 'text-red-400'
}

function scoreBg(s: number): string {
  return s >= 75 ? 'bg-green-500' : s >= 50 ? 'bg-yellow-500' : 'bg-red-500'
}

function fmtWeek(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function verdictLabel(v: 'high_quality' | 'average' | 'low_quality'): string {
  return v === 'high_quality' ? 'Strong ROI' : v === 'average' ? 'Medium ROI' : 'Low ROI'
}

function verdictTone(v: 'high_quality' | 'average' | 'low_quality'): 'green' | 'yellow' | 'red' {
  return v === 'high_quality' ? 'green' : v === 'average' ? 'yellow' : 'red'
}

/* ── PAGE ── */
export function HealthPage() {
  const health = useQuery({
    queryKey: ['analytics', 'health'],
    queryFn: api.analytics.health,
    staleTime: 5 * 60 * 1000,
  })
  const outcomes = useQuery({
    queryKey: ['analytics', 'outcomes'],
    queryFn: api.analytics.outcomes,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  if (health.isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-32 text-[#888888]">
        <Spinner />
        <span className="text-sm">Analysing codebase health…</span>
      </div>
    )
  }

  const data = health.data

  if (!data || data.totalAiPrs === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Codebase Health</h1>
          <p className="mt-1 text-sm text-[#888888]">AI code quality, risk signals, and team performance over time</p>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <Activity className="mx-auto h-10 w-10 text-[#333] mb-4" />
            <div className="text-base font-medium text-[#555] mb-2">No health data yet</div>
            <p className="text-sm text-[#444] max-w-sm mx-auto mb-6">
              Connect a repo and merge 5+ AI-assisted PRs to see your codebase health score.
            </p>
            <Link
              to="/settings"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-[#e5e5e5] transition-colors"
            >
              Go to Settings
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const toolBreakdown = outcomes.data?.toolBreakdown ?? []
  const showRiskSignals = data.riskSignals.length > 0 && data.riskLevel !== 'low'
  const showToolComparison = toolBreakdown.length >= 2

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Codebase Health</h1>
        <p className="mt-1 text-sm text-[#888888]">AI code quality, risk signals, and team performance over time</p>
      </div>

      {/* Section 1: Health Score */}
      <HealthScoreCard data={data} />

      {/* Risk Signals */}
      {showRiskSignals && (
        <RiskSignalsCard signals={data.riskSignals} riskLevel={data.riskLevel as 'medium' | 'high'} />
      )}

      {/* Section 2: 12-week trend */}
      {data.trend.length > 0 && <HealthTrendChart trend={data.trend} />}

      {/* Section 3: Developer Performance */}
      <DeveloperPerformanceTable developers={data.developers} />

      {/* Section 4: Tool Comparison */}
      {showToolComparison && <ToolComparisonTable tools={toolBreakdown} />}
    </div>
  )
}

/* ── Section 1: Health Score Card ── */
function HealthScoreCard({ data }: { data: HealthResponse }) {
  const { healthScore, revertRate, hotfixRate, avgReviewCycles, weekCount } = data
  const ringColor = healthScore >= 75 ? '#22c55e' : healthScore >= 50 ? '#eab308' : '#ef4444'
  const scoreClass = scoreColor(healthScore)

  return (
    <Card>
      <CardContent className="py-8">
        <div className="flex flex-col sm:flex-row items-center gap-8">
          {/* Ring + score */}
          <div className="flex flex-col items-center flex-shrink-0">
            <div
              className="relative flex items-center justify-center rounded-full"
              style={{
                width: 120,
                height: 120,
                background: `conic-gradient(${ringColor} ${healthScore * 3.6}deg, #1f1f1f ${healthScore * 3.6}deg)`,
                padding: 8,
                borderRadius: '50%',
              }}
            >
              <div
                className="flex flex-col items-center justify-center bg-[#111] rounded-full"
                style={{ width: '100%', height: '100%' }}
              >
                <span className={cn('text-3xl font-bold tabular-nums', scoreClass)}>{healthScore}</span>
                <span className="text-xs text-[#555]">/100</span>
              </div>
            </div>
            <span className="mt-3 text-xs text-[#555] text-center">
              {weekCount > 0 ? `Based on ${weekCount} week${weekCount === 1 ? '' : 's'} of data` : 'All-time score'}
            </span>
          </div>

          {/* Sub-stats */}
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-12 flex-1 items-center sm:items-start">
            <SubStat label="Revert Rate" value={`${revertRate}%`} tone={revertRate > 8 ? 'red' : 'white'} hint="Healthy: < 8%" />
            <SubStat label="Hotfix Rate" value={`${hotfixRate}%`} tone={hotfixRate > 10 ? 'red' : 'white'} hint="Healthy: < 10%" />
            <SubStat label="Avg Review Cycles" value={avgReviewCycles.toFixed(1)} tone={avgReviewCycles > 2 ? 'yellow' : 'white'} hint="Healthy: ≤ 2" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SubStat({ label, value, tone, hint }: { label: string; value: string; tone: 'red' | 'yellow' | 'white'; hint: string }) {
  const valueClass = tone === 'red' ? 'text-red-400' : tone === 'yellow' ? 'text-yellow-400' : 'text-white'
  return (
    <div className="text-center sm:text-left">
      <div className="text-xs text-[#555] uppercase tracking-widest mb-1">{label}</div>
      <div className={cn('text-2xl font-bold tabular-nums', valueClass)}>{value}</div>
      <div className="text-xs text-[#444] mt-1">{hint}</div>
    </div>
  )
}

/* ── Risk Signals ── */
function RiskSignalsCard({
  signals, riskLevel,
}: {
  signals: HealthResponse['riskSignals']
  riskLevel: 'medium' | 'high'
}) {
  const isHigh = riskLevel === 'high'
  return (
    <div className={cn(
      'rounded-xl border px-5 py-4',
      isHigh ? 'border-red-500/30 bg-red-500/5' : 'border-yellow-500/30 bg-yellow-500/5',
    )}>
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className={cn('h-4 w-4 flex-shrink-0', isHigh ? 'text-red-500' : 'text-yellow-500')} />
        <span className="text-sm font-semibold text-white">Risk Signals Detected</span>
        <Badge tone={isHigh ? 'red' : 'yellow'}>{isHigh ? 'High Risk' : 'Medium Risk'}</Badge>
      </div>
      <ul className="space-y-2">
        {signals.map((s, i) => (
          <li key={i} className={cn('flex items-start gap-2 text-sm', isHigh ? 'text-red-200' : 'text-yellow-200')}>
            <span className="flex-shrink-0 mt-0.5">⚠</span>
            {s.description}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Section 2: Trend Chart ── */
function HealthTrendChart({ trend }: { trend: HealthResponse['trend'] }) {
  const chartData = trend.map((t) => ({ week: fmtWeek(t.weekStart), score: t.score }))
  const latest = chartData[chartData.length - 1]?.score ?? 100
  const strokeColor = latest >= 75 ? '#22c55e' : latest >= 50 ? '#eab308' : '#ef4444'

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Health Score Over Time</CardTitle>
        <span className="text-xs text-[#555]">last 12 weeks</span>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
          <div style={{ minWidth: 380 }}>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="healthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={strokeColor} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#555555' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#555555' }} axisLine={false} tickLine={false} width={32} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]?.payload as { week: string; score: number }
                    return (
                      <div className="rounded-lg border border-[#333] bg-[#111] px-3 py-2 text-xs shadow-xl">
                        <div className="font-medium text-white mb-1">{row.week}</div>
                        <div className={scoreColor(row.score)}>Score: <span className="font-semibold">{row.score}/100</span></div>
                      </div>
                    )
                  }}
                />
                <ReferenceLine y={75} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.35} />
                <ReferenceLine y={50} stroke="#eab308" strokeDasharray="4 4" strokeOpacity={0.35} />
                <Area
                  type="monotone"
                  dataKey="score"
                  stroke={strokeColor}
                  strokeWidth={2}
                  fill="url(#healthGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: strokeColor, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="flex items-center gap-5 mt-3 text-xs text-[#555]">
          <span><span className="inline-block w-6 border-t border-dashed border-green-500/50 mr-1.5 align-middle" /> ≥ 75 Strong</span>
          <span><span className="inline-block w-6 border-t border-dashed border-yellow-500/50 mr-1.5 align-middle" /> 50–74 Medium</span>
          <span className="text-[#444]">below 50 = risk</span>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Section 3: Developer Performance ── */
function DeveloperPerformanceTable({ developers }: { developers: HealthDevRow[] }) {
  if (developers.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Developer Performance</CardTitle></CardHeader>
        <CardContent>
          <div className="py-8 text-center">
            <Users className="mx-auto h-8 w-8 text-[#333] mb-3" />
            <p className="text-sm text-[#555]">No developer data yet — merge AI-assisted PRs to see per-developer scores.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle>Developer Performance</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
          <table className="w-full text-sm" style={{ minWidth: 600 }}>
            <thead>
              <tr className="border-b border-[#1a1a1a]">
                {['Developer', 'AI PRs', 'Quality Score', 'Primary Tool', 'Trend', 'Status'].map((h) => (
                  <th key={h} className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-widest text-[#555]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#111]">
              {developers.map((dev) => <DevRow key={dev.githubLogin} dev={dev} />)}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function DevRow({ dev }: { dev: HealthDevRow }) {
  const statusConfig: Record<string, { label: string; tone: 'green' | 'blue' | 'yellow' }> = {
    power_user: { label: 'Power User', tone: 'green' },
    active: { label: 'Active', tone: 'blue' },
    needs_support: { label: 'Needs Support', tone: 'yellow' },
  }
  const cfg = statusConfig[dev.status] ?? { label: 'Active', tone: 'blue' as const }

  const trendEl =
    dev.trend === 'up' ? <span className="text-green-400 font-bold text-base">↑</span> :
    dev.trend === 'down' ? <span className="text-red-400 font-bold text-base">↓</span> :
    <span className="text-[#555]">→</span>

  return (
    <tr>
      <td className="py-3 pr-4 sticky left-0 bg-[#111111]">
        <div className="flex items-center gap-2">
          {dev.avatarUrl ? (
            <img src={dev.avatarUrl} alt="" className="h-7 w-7 rounded-full border border-[#333] flex-shrink-0" />
          ) : (
            <div className="h-7 w-7 rounded-full bg-[#222] border border-[#333] flex-shrink-0 flex items-center justify-center text-xs font-semibold text-white">
              {dev.githubLogin[0]?.toUpperCase()}
            </div>
          )}
          <span className="text-white font-medium whitespace-nowrap">@{dev.githubLogin}</span>
        </div>
      </td>
      <td className="py-3 pr-4 tabular-nums text-white">{dev.weeklyAiPrs}</td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2" style={{ minWidth: 110 }}>
          <div className="flex-1 h-1.5 rounded-full bg-[#222] overflow-hidden">
            <div className={cn('h-full rounded-full', scoreBg(dev.qualityScore))} style={{ width: `${dev.qualityScore}%` }} />
          </div>
          <span className={cn('text-xs font-semibold tabular-nums w-7 text-right flex-shrink-0', scoreColor(dev.qualityScore))}>
            {dev.qualityScore}
          </span>
        </div>
      </td>
      <td className="py-3 pr-4">
        {dev.primaryTool
          ? <Badge tone="gray">{toolName(dev.primaryTool)}</Badge>
          : <span className="text-[#555] text-xs">—</span>}
      </td>
      <td className="py-3 pr-4">{trendEl}</td>
      <td className="py-3"><Badge tone={cfg.tone}>{cfg.label}</Badge></td>
    </tr>
  )
}

/* ── Section 4: Tool Comparison ── */
function ToolComparisonTable({ tools }: { tools: OutcomesResponse['toolBreakdown'] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Tool Comparison</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
          <table className="w-full text-sm" style={{ minWidth: 560 }}>
            <thead>
              <tr className="border-b border-[#1a1a1a]">
                {['Tool', 'PRs', 'Quality Score', 'Est. Spend', 'Revert Rate', 'Verdict'].map((h) => (
                  <th key={h} className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-widest text-[#555]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#111]">
              {tools.map((tool) => (
                <tr key={tool.tool}>
                  <td className="py-3 pr-4 font-medium text-white sticky left-0 bg-[#111111]">{toolName(tool.tool)}</td>
                  <td className="py-3 pr-4 tabular-nums text-white">{tool.prCount}</td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2" style={{ minWidth: 110 }}>
                      <div className="flex-1 h-1.5 rounded-full bg-[#222] overflow-hidden">
                        <div className={cn('h-full rounded-full', scoreBg(tool.qualityScore))} style={{ width: `${tool.qualityScore}%` }} />
                      </div>
                      <span className={cn('text-xs font-semibold w-7 text-right flex-shrink-0', scoreColor(tool.qualityScore))}>
                        {tool.qualityScore}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-white">
                    {tool.estimatedMonthlySpend > 0 ? formatUsd(tool.estimatedMonthlySpend) : '—'}
                  </td>
                  <td className={cn('py-3 pr-4 tabular-nums font-medium', tool.revertRate > 8 ? 'text-red-400' : 'text-white')}>
                    {tool.revertRate}%
                  </td>
                  <td className="py-3">
                    <Badge tone={verdictTone(tool.verdict)}>{verdictLabel(tool.verdict)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

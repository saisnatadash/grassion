import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  EyeOff, Activity, FileText, BarChart2, Settings, ArrowRight,
  CheckCircle, AlertTriangle, Circle, Zap,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { cn, planDisplayLabel } from '../lib/utils.js'
import { Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'

function SetupStep({
  done,
  label,
  hint,
  linkTo,
  linkLabel,
}: {
  done: boolean
  label: string
  hint: string
  linkTo?: string
  linkLabel?: string
}) {
  return (
    <div className="flex items-start gap-3">
      {done
        ? <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
        : <Circle className="h-5 w-5 text-[#444] flex-shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className={cn('text-sm font-medium', done ? 'text-[#555] line-through' : 'text-white')}>{label}</div>
        {!done && (
          <div className="text-xs text-[#555] mt-0.5">
            {hint}
            {linkTo && linkLabel && (
              <Link to={linkTo} className="ml-1.5 text-blue-400 hover:text-blue-300 underline">{linkLabel}</Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function OverviewPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const health = useQuery({
    queryKey: ['analytics', 'health'],
    queryFn: api.analytics.health,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const seatWaste = useQuery({
    queryKey: ['analytics', 'seat-waste'],
    queryFn: api.analytics.seatWaste,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })

  const team = me.data?.team
  const user = me.data?.user
  const installed = !!team?.githubInstallationId
  const activeRepos = (repos.data ?? []).filter((r) => r.isActive)
  const spendSet = (team?.monthlyAiSpendUsd ?? 0) > 0
  const setupComplete = installed && activeRepos.length > 0 && spendSet

  const healthScore = health.data?.healthScore ?? null
  const riskLevel = health.data?.riskLevel ?? 'low'
  const totalAiPrs = health.data?.totalAiPrs ?? 0
  const inactiveSeats = seatWaste.data?.inactiveUsers.length ?? 0
  const hasHealthData = totalAiPrs > 0

  const riskTone = riskLevel === 'high' ? 'text-red-400' : riskLevel === 'medium' ? 'text-yellow-400' : 'text-green-400'
  const riskLabel = riskLevel === 'high' ? 'High' : riskLevel === 'medium' ? 'Medium' : 'Low'

  if (me.isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-32 text-[#888888]">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            {user?.githubLogin ? `Hey, ${user.githubLogin}` : 'Overview'}
          </h1>
          <p className="mt-1 text-sm text-[#555]">
            {team?.name} &middot; <span className="capitalize">{planDisplayLabel(team?.plan ?? 'free')}</span> plan
            {activeRepos.length > 0 && ` · ${activeRepos.length} repo${activeRepos.length === 1 ? '' : 's'} connected`}
          </p>
        </div>
        {!setupComplete && (
          <Badge tone="yellow">Setup incomplete</Badge>
        )}
      </div>

      {/* Setup checklist — only shown until all three steps are done */}
      {!setupComplete && (
        <Card>
          <CardHeader>
            <CardTitle>Get started</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SetupStep
              done={installed}
              label="Install the GitHub App"
              hint="Grassion needs access to read your PR history."
              linkTo="/settings"
              linkLabel="Go to Settings"
            />
            <SetupStep
              done={activeRepos.length > 0}
              label="Enable at least one repository"
              hint="Toggle repos on in Settings so Grassion can analyze them."
              linkTo="/settings"
              linkLabel="Enable repos"
            />
            <SetupStep
              done={spendSet}
              label="Set your monthly AI tool spend"
              hint="Needed to calculate ROI. Even a rough number works."
              linkTo="/settings"
              linkLabel="Set spend"
            />
            {setupComplete && (
              <p className="text-xs text-green-500 pt-1">
                All set. Backfill runs automatically — your 12-month history will appear within a few minutes.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[#222] bg-[#111] p-4">
          <div className="text-xs text-[#555] uppercase tracking-widest mb-2">Health Score</div>
          {health.isLoading ? (
            <div className="h-8 w-10 bg-[#1a1a1a] rounded animate-pulse" />
          ) : hasHealthData ? (
            <div className={cn(
              'text-3xl font-bold tabular-nums',
              (healthScore ?? 0) >= 75 ? 'text-green-400' : (healthScore ?? 0) >= 50 ? 'text-yellow-400' : 'text-red-400',
            )}>{healthScore}<span className="text-sm text-[#555] font-normal ml-1">/100</span></div>
          ) : (
            <div className="text-sm text-[#444]">No data yet</div>
          )}
        </div>

        <div className="rounded-xl border border-[#222] bg-[#111] p-4">
          <div className="text-xs text-[#555] uppercase tracking-widest mb-2">AI PRs Analyzed</div>
          {health.isLoading ? (
            <div className="h-8 w-10 bg-[#1a1a1a] rounded animate-pulse" />
          ) : (
            <div className="text-3xl font-bold tabular-nums text-white">{totalAiPrs.toLocaleString()}</div>
          )}
        </div>

        <div className="rounded-xl border border-[#222] bg-[#111] p-4">
          <div className="text-xs text-[#555] uppercase tracking-widest mb-2">Risk Level</div>
          {health.isLoading ? (
            <div className="h-8 w-16 bg-[#1a1a1a] rounded animate-pulse" />
          ) : hasHealthData ? (
            <div className={cn('text-3xl font-bold', riskTone)}>{riskLabel}</div>
          ) : (
            <div className="text-sm text-[#444]">No data yet</div>
          )}
        </div>

        <div className="rounded-xl border border-[#222] bg-[#111] p-4">
          <div className="text-xs text-[#555] uppercase tracking-widest mb-2">Inactive Seats</div>
          {seatWaste.isLoading ? (
            <div className="h-8 w-10 bg-[#1a1a1a] rounded animate-pulse" />
          ) : (
            <div className={cn(
              'text-3xl font-bold tabular-nums',
              inactiveSeats > 0 ? 'text-yellow-400' : 'text-white',
            )}>{inactiveSeats}</div>
          )}
          {inactiveSeats > 0 && (
            <div className="text-xs text-[#555] mt-1">devs not using AI</div>
          )}
        </div>
      </div>

      {/* Risk alert if high */}
      {riskLevel === 'high' && hasHealthData && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-200">
            High risk signals detected. <Link to="/code-map" className="underline hover:text-white">View Review Map</Link> for details.
          </span>
        </div>
      )}

      {/* Quick nav cards */}
      <div>
        <h2 className="text-xs font-medium text-[#555] uppercase tracking-widest mb-3">Explore</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              to: '/dark-code',
              icon: EyeOff,
              label: 'AI Code Risk',
              desc: 'Dark areas, fragile code, 12-month coverage map',
              color: 'text-purple-400',
            },
            {
              to: '/code-map',
              icon: Activity,
              label: 'Review Map',
              desc: 'Health score, developer performance, risk signals',
              color: 'text-blue-400',
            },
            {
              to: '/receipts',
              icon: FileText,
              label: 'Merge Receipts',
              desc: 'Per-PR accountability records and attestation log',
              color: 'text-green-400',
            },
            {
              to: '/reports',
              icon: BarChart2,
              label: 'Reports',
              desc: 'AI ROI, governance, audit export',
              color: 'text-yellow-400',
            },
          ].map(({ to, icon: Icon, label, desc, color }) => (
            <Link
              key={to}
              to={to}
              className="group rounded-xl border border-[#222] bg-[#111] p-4 hover:border-[#333] hover:bg-[#161616] transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <Icon className={cn('h-4 w-4', color)} />
                <ArrowRight className="h-3.5 w-3.5 text-[#333] group-hover:text-[#666] transition-colors" />
              </div>
              <div className="text-sm font-medium text-white mb-1">{label}</div>
              <div className="text-xs text-[#555] leading-relaxed">{desc}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* What Grassion tracks — shown only until there's real data */}
      {!hasHealthData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-400" />
              What Grassion tracks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4 text-sm text-[#888]">
              {[
                'Which PRs were written with AI tools and how much',
                'Who reviewed each AI-heavy change and when',
                'Code areas with zero human coverage (dark areas)',
                'PRs merged without review or attestation',
                'Weekly ROI verdict: hours saved vs rework cost',
                'Health score trend over the last 12 weeks',
              ].map((item) => (
                <div key={item} className="flex items-start gap-2">
                  <span className="text-green-500 flex-shrink-0 mt-0.5">+</span>
                  {item}
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-[#444]">
              Data appears within a few minutes of connecting your first repo. Grassion backfills 12 months of PR history automatically.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

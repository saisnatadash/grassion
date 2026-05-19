import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserX, Users, TrendingDown, AlertCircle, Download, Lock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, type SeatWasteResponse } from '../lib/api.js'
import { formatUsd, cn } from '../lib/utils.js'
import { usePlan } from '../lib/plan.js'
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner, StatCard } from '../components/ui.js'

type ActiveUser = SeatWasteResponse['activeUsers'][number]
type InactiveUser = SeatWasteResponse['inactiveUsers'][number]

function daysAgo(iso: string | null): string {
  if (!iso) return 'never'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (d === 0) return 'today'
  if (d === 1) return '1 day ago'
  return `${d} days ago`
}

export function SeatWastePage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics', 'seat-waste'],
    queryFn: api.analytics.seatWaste,
  })
  const { isPaid } = usePlan()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-32 text-[#888888]">
        <Spinner />
        <span className="text-sm">Analysing seat usage…</span>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Alert tone="red">Failed to load seat data. Check your connection and try again.</Alert>
        <Button variant="secondary" onClick={() => refetch()}>Retry</Button>
      </div>
    )
  }

  const monthlyWaste = data.totalMonthlySavings
  const annualWaste = monthlyWaste * 12
  const hasInactive = data.inactiveUsers.length > 0
  const perSeat = data.inactiveUsers[0]?.monthlyCost ?? 0

  const allUsers: Array<{ user: ActiveUser | InactiveUser; active: boolean }> = [
    ...data.inactiveUsers.map((u) => ({ user: u, active: false })),
    ...data.activeUsers.map((u) => ({ user: u, active: true })),
  ]

  return (
    <div className="space-y-6">

      {/* ── HEADER ── */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Seat Waste Calculator</h1>
        <p className="mt-1 text-sm text-[#888888]">
          Every developer who pushed a PR in the last 30 days is tracked. Those with zero
          AI-assisted PRs in the last 7 days are flagged as inactive seats.
        </p>
      </div>

      {/* ── SUMMARY STAT CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Seats"
          value={data.totalSeats}
          sub="active PR authors · 30d"
        />
        <StatCard
          label="Active Seats"
          value={data.activeUsers.length}
          sub="AI PR in last 7d"
          tone="green"
        />
        <StatCard
          label="Inactive Seats"
          value={data.inactiveUsers.length}
          sub={`of ${data.totalSeats} total seats`}
          tone={hasInactive ? 'red' : 'white'}
        />
        <StatCard
          label="Monthly Waste"
          value={formatUsd(monthlyWaste)}
          sub={perSeat > 0 ? `${formatUsd(perSeat)}/seat` : 'no waste detected'}
          tone={monthlyWaste > 0 ? 'red' : 'white'}
        />
      </div>

      {/* ── ANNUAL WASTE BANNER ── */}
      {hasInactive && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-red-500/10 p-2">
              <TrendingDown className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <div className="text-sm font-medium text-white">Projected Annual Waste</div>
              <div className="text-xs text-[#888888]">{data.inactiveUsers.length} inactive seat{data.inactiveUsers.length === 1 ? '' : 's'} × 12 months</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-2xl font-bold text-red-500 tabular-nums">{formatUsd(annualWaste)}</div>
            <Badge tone="red">Action required</Badge>
          </div>
        </div>
      )}

      {/* ── DEVELOPER LIST ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Team seat usage</CardTitle>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-[#555555]">
              <span className="h-2 w-2 rounded-full bg-green-500" /> Active
            </span>
            <span className="flex items-center gap-1.5 text-xs text-[#555555]">
              <span className="h-2 w-2 rounded-full bg-red-500" /> Inactive
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
            <ul className="divide-y divide-[#1a1a1a]">
              {allUsers.map(({ user, active }) => (
                <DevRow key={user.githubLogin} user={user} active={active} />
              ))}
            </ul>
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

/* ── CSV EXPORT BUTTON ── */
function CsvExportButton({
  isPaid,
  data,
}: {
  isPaid: boolean
  data: SeatWasteResponse | undefined
}) {
  function exportCsv() {
    if (!data) return
    const rows = [
      ['Username', 'Status', 'Weekly AI PRs', 'Last Active', 'Monthly Cost'],
      ...data.activeUsers.map((u) => [u.githubLogin, 'Active', String(u.weeklyAiPrs), u.lastActivity ?? 'N/A', '$0']),
      ...data.inactiveUsers.map((u) => [u.githubLogin, 'Inactive', '0', u.lastActivity ?? 'N/A', `$${u.monthlyCost}`]),
    ]
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'seat-waste.csv'
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
      {/* Avatar */}
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

      {/* Name + sub */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 rounded-full flex-shrink-0',
              active ? 'bg-green-500' : 'bg-red-500',
            )}
          />
          <span className="text-sm font-medium text-white truncate">@{user.githubLogin}</span>
        </div>
        <div className="text-xs text-[#888888] mt-0.5 pl-4">
          {active
            ? `${(user as ActiveUser).weeklyAiPrs} AI PR${(user as ActiveUser).weeklyAiPrs === 1 ? '' : 's'} this week`
            : `Last active ${daysAgo(user.lastActivity)}`}
        </div>
      </div>

      {/* Right: cost + badge */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {!active && (
          <span className="text-sm font-medium text-red-500 tabular-nums">
            {formatUsd((user as InactiveUser).monthlyCost)}/mo
          </span>
        )}
        <Badge tone={active ? 'green' : 'red'}>{active ? 'Active' : 'Inactive'}</Badge>
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
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-500" />
          <CardTitle>Recommended actions</CardTitle>
        </div>
        <Button variant="secondary" size="sm" onClick={copyUsernames}>
          {copied ? 'Copied!' : 'Copy usernames'}
        </Button>
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
                  Inactive
                </Badge>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-lg border border-[#222] bg-[#0a0a0a] px-4 py-3 text-xs text-[#888888]">
          Reach out to these developers to re-onboard them on your AI coding tools, or consider
          removing their seats to reclaim the budget.
        </div>
      </CardContent>
    </Card>
  )
}

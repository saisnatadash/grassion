import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type SeatWasteResponse } from '../lib/api.js'
import { formatUsd, cn } from '../lib/utils.js'
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-neutral-500">
        <Spinner />
        <span className="ml-2">Analysing seat usage…</span>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Alert tone="red">Failed to load seat data. Check your connection and try again.</Alert>
        <Button variant="secondary" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const monthlyWaste = data.totalMonthlySavings
  const annualWaste = monthlyWaste * 12
  const hasInactive = data.inactiveUsers.length > 0

  // Inactive first, then active
  const allUsers: Array<{ user: ActiveUser | InactiveUser; active: boolean }> = [
    ...data.inactiveUsers.map((u) => ({ user: u, active: false })),
    ...data.activeUsers.map((u) => ({ user: u, active: true })),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Seat Waste Calculator</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Developers who haven't opened an AI-assisted PR in the last 7 days are counted as inactive.
        </p>
      </div>

      {/* Summary card */}
      <Card>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-6 p-6">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Total seats</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">{data.totalSeats}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Inactive seats</div>
            <div
              className={cn(
                'mt-1 text-3xl font-semibold tabular-nums',
                hasInactive ? 'text-red-700' : 'text-green-700',
              )}
            >
              {data.inactiveUsers.length}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Monthly waste</div>
            <div className={cn('mt-1 text-3xl font-semibold tabular-nums', hasInactive ? 'text-red-700' : 'text-green-700')}>
              {formatUsd(monthlyWaste)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Annual waste</div>
            <div className={cn('mt-1 text-3xl font-semibold tabular-nums', hasInactive ? 'text-red-700' : 'text-green-700')}>
              {formatUsd(annualWaste)}
            </div>
            <div className="mt-2">
              <Badge tone={hasInactive ? 'red' : 'green'}>
                {hasInactive ? `${data.inactiveUsers.length} unused` : 'All seats active'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Developer grid */}
      <Card>
        <CardHeader>
          <CardTitle>Team seat usage</CardTitle>
        </CardHeader>
        <CardContent>
          {allUsers.length === 0 ? (
            <p className="text-sm text-neutral-500">No team members found.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {allUsers.map(({ user, active }) => (
                <DevCard key={user.githubLogin} user={user} active={active} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recommended actions */}
      {data.inactiveUsers.length > 0 && (
        <RecommendedActions inactiveUsers={data.inactiveUsers} />
      )}
    </div>
  )
}

function DevCard({ user, active }: { user: ActiveUser | InactiveUser; active: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.githubLogin}
          className="h-9 w-9 rounded-full flex-shrink-0"
        />
      ) : (
        <div className="h-9 w-9 rounded-full bg-neutral-200 flex-shrink-0 flex items-center justify-center text-xs font-medium text-neutral-600">
          {user.githubLogin[0]?.toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn('h-2 w-2 rounded-full flex-shrink-0', active ? 'bg-green-500' : 'bg-red-500')}
          />
          <span className="truncate text-sm font-medium text-neutral-900">@{user.githubLogin}</span>
        </div>
        <div className="text-xs text-neutral-500 mt-0.5">
          {active
            ? `${(user as ActiveUser).weeklyAiPrs} AI PR${(user as ActiveUser).weeklyAiPrs === 1 ? '' : 's'} this week`
            : `Last active ${daysAgo(user.lastActivity)}`}
        </div>
      </div>
    </div>
  )
}

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
        <CardTitle>Recommended actions</CardTitle>
        <Button variant="secondary" size="sm" onClick={copyUsernames}>
          {copied ? 'Copied!' : 'Copy usernames'}
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-neutral-100">
          {inactiveUsers.map((u) => (
            <li key={u.githubLogin} className="py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {u.avatarUrl ? (
                  <img src={u.avatarUrl} alt={u.githubLogin} className="h-7 w-7 rounded-full" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-neutral-200 flex items-center justify-center text-xs font-medium text-neutral-600">
                    {u.githubLogin[0]?.toUpperCase()}
                  </div>
                )}
                <span className="text-sm text-neutral-700">
                  <span className="font-medium">@{u.githubLogin}</span>
                  {' · '}last active {daysAgo(u.lastActivity)}
                  {' · '}
                  <span className="text-red-700 font-medium">{formatUsd(u.monthlyCost)}/month wasted</span>
                </span>
              </div>
              <Badge tone="red">Inactive</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

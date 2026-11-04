import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { Badge, Button, Card, CardContent, Input, Spinner } from '../components/ui.js'
import { downloadCsv } from '../lib/csv.js'

export function AdminTeams() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['admin-teams', page, search],
    queryFn: () => api.adminTeams({ page, search }),
  })

  if (isLoading) return <Spinner />

  const teams = (data?.teams ?? []) as Array<Record<string, unknown>>
  const total = data?.total ?? 0
  const limit = data?.limit ?? 50

  function planColor(plan: string) {
    if (['enterprise'].includes(plan)) return 'bg-purple-500/20 text-purple-300'
    if (['business'].includes(plan)) return 'bg-blue-500/20 text-blue-300'
    if (['pro', 'team', 'growth'].includes(plan)) return 'bg-green-500/20 text-green-300'
    return 'bg-white/10 text-white/50'
  }

  function handleExport() {
    if (!teams.length) return
    const cols = ['id', 'plan', 'userCount', 'repoCount', 'subscriptionStatus', 'createdAt']
    downloadCsv(teams, cols, 'teams.csv')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Teams & Users</h1>
        <Button variant="secondary" size="sm" onClick={handleExport}>Export CSV</Button>
      </div>
      <div className="flex gap-2">
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search…"
          className="w-64"
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/40 text-xs uppercase tracking-wider">
                <th className="text-left p-3">Team ID</th>
                <th className="text-left p-3">Plan</th>
                <th className="text-right p-3">Users</th>
                <th className="text-right p-3">Repos</th>
                <th className="text-left p-3">Subscription</th>
                <th className="text-left p-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={String(t.id)} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-3 font-mono text-xs text-white/50">{String(t.id).slice(0, 8)}…</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-mono ${planColor(String(t.plan))}`}>
                      {String(t.plan)}
                    </span>
                  </td>
                  <td className="p-3 text-right text-white/70">{String(t.userCount)}</td>
                  <td className="p-3 text-right text-white/70">{String(t.repoCount)}</td>
                  <td className="p-3 text-white/50 text-xs">{String(t.subscriptionStatus ?? '—')}</td>
                  <td className="p-3 text-white/40 text-xs">{new Date(String(t.createdAt)).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <div className="flex items-center justify-between text-sm text-white/40">
        <span>Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>Prev</Button>
          <Button variant="secondary" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * limit >= total}>Next</Button>
        </div>
      </div>
    </div>
  )
}

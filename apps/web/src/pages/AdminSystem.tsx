import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'

const PRESETS = [{ label: '7d', days: 7 }, { label: '30d', days: 30 }]

export function AdminSystem() {
  const [days, setDays] = useState(7)
  const from = new Date(Date.now() - days * 86400_000).toISOString()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-system', days],
    queryFn: () => api.adminSystem({ from }),
  })
  if (isLoading) return <Spinner />
  if (!data) return null

  const llm = data.llm as {
    byDay: Array<{ date: string; spend: number; calls: number }>
    byTeam: Array<{ teamId: string | null; spend: number; calls: number }>
    byModel: Array<{ model: string; spend: number; calls: number }>
    caps: { dailyCapUsd: number; monthlyCapUsd: number }
  }
  const webhooks = data.webhooks as { total: number; unprocessed: number }
  const queue = data.queue as { pending: number; stuck: number }
  const auditRows = (data.recentAdminActions ?? []) as Array<Record<string, unknown>>

  const totalSpend = llm.byDay.reduce((s, r) => s + (Number(r.spend) || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">System Health</h1>
        <div className="flex gap-2">
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => setDays(p.days)}
              className={`px-3 py-1 text-sm rounded ${days === p.days ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5">
          <div className="text-2xl font-semibold">${totalSpend.toFixed(2)}</div>
          <div className="text-sm text-white/50">LLM spend ({days}d)</div>
          <div className="text-xs text-white/30">Cap: ${llm.caps.dailyCapUsd}/day · ${llm.caps.monthlyCapUsd}/mo</div>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="text-2xl font-semibold">{webhooks.total}</div>
          <div className="text-sm text-white/50">Webhooks received</div>
          {webhooks.unprocessed > 0 && <div className="text-xs text-red-400">{webhooks.unprocessed} unprocessed</div>}
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="text-2xl font-semibold">{queue.pending}</div>
          <div className="text-sm text-white/50">Queue pending</div>
          {queue.stuck > 0 && <div className="text-xs text-red-400">{queue.stuck} stuck (≥5 attempts)</div>}
        </CardContent></Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>LLM spend by day</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead><tr className="text-white/40 text-xs uppercase border-b border-white/10">
                <th className="text-left pb-2">Date</th>
                <th className="text-right pb-2">Spend</th>
                <th className="text-right pb-2">Calls</th>
              </tr></thead>
              <tbody>
                {llm.byDay.map(r => (
                  <tr key={r.date} className="border-b border-white/5">
                    <td className="py-1.5 text-white/70">{r.date}</td>
                    <td className="py-1.5 text-right">${Number(r.spend).toFixed(3)}</td>
                    <td className="py-1.5 text-right">{r.calls}</td>
                  </tr>
                ))}
                {llm.byDay.length === 0 && <tr><td colSpan={3} className="py-2 text-white/30 text-sm">No LLM calls in range</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Top teams by LLM spend</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead><tr className="text-white/40 text-xs uppercase border-b border-white/10">
                <th className="text-left pb-2">Team</th>
                <th className="text-right pb-2">Spend</th>
                <th className="text-right pb-2">Calls</th>
              </tr></thead>
              <tbody>
                {llm.byTeam.map((r, i) => (
                  <tr key={i} className="border-b border-white/5">
                    <td className="py-1.5 font-mono text-xs text-white/50">{r.teamId ? String(r.teamId).slice(0, 8) + '…' : 'global'}</td>
                    <td className="py-1.5 text-right">${Number(r.spend).toFixed(3)}</td>
                    <td className="py-1.5 text-right">{r.calls}</td>
                  </tr>
                ))}
                {llm.byTeam.length === 0 && <tr><td colSpan={3} className="py-2 text-white/30 text-sm">No data</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Admin access log</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="text-white/40 text-xs uppercase border-b border-white/10">
              <th className="text-left pb-2">Who</th>
              <th className="text-left pb-2">Method</th>
              <th className="text-left pb-2">Route</th>
              <th className="text-left pb-2">When</th>
            </tr></thead>
            <tbody>
              {auditRows.map((r) => (
                <tr key={String(r.id)} className="border-b border-white/5">
                  <td className="py-1.5 text-white/70">{String(r.githubLogin)}</td>
                  <td className="py-1.5 font-mono text-xs text-white/50">{String(r.method)}</td>
                  <td className="py-1.5 font-mono text-xs text-white/70">{String(r.route)}</td>
                  <td className="py-1.5 text-white/40 text-xs">{new Date(String(r.occurredAt)).toLocaleString()}</td>
                </tr>
              ))}
              {auditRows.length === 0 && <tr><td colSpan={4} className="py-2 text-white/30 text-sm">No admin actions logged</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'
import { downloadCsv } from '../lib/csv.js'

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

export function AdminEngagement() {
  const [days, setDays] = useState(30)
  const from = new Date(Date.now() - days * 86400_000).toISOString()
  const to = new Date().toISOString()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-engagement', days],
    queryFn: () => api.adminEngagement({ from, to }),
  })

  if (isLoading) return <Spinner />

  const daily = (data?.daily ?? []) as Array<{ date: string; sessions: number; events: number; pageViews: number }>
  const totals = data?.totals as { uniqueSessions: number; total: number } | undefined

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Engagement</h1>
        <div className="flex gap-2">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => setDays(p.days)}
              className={`px-3 py-1 text-sm rounded transition-colors ${days === p.days ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white'}`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => downloadCsv(daily, ['date', 'sessions', 'events', 'pageViews'], 'engagement.csv')}
            className="px-3 py-1 text-sm text-white/40 hover:text-white border border-white/20 rounded ml-2"
          >
            CSV
          </button>
        </div>
      </div>
      {totals && (
        <div className="grid grid-cols-2 gap-4">
          <Card><CardContent className="pt-5">
            <div className="text-2xl font-semibold">{totals.uniqueSessions}</div>
            <div className="text-sm text-white/50">Unique sessions</div>
          </CardContent></Card>
          <Card><CardContent className="pt-5">
            <div className="text-2xl font-semibold">{totals.total}</div>
            <div className="text-sm text-white/50">Total events</div>
          </CardContent></Card>
        </div>
      )}
      <Card>
        <CardHeader><CardTitle>Daily sessions & page views</CardTitle></CardHeader>
        <CardContent>
          {daily.length === 0 ? (
            <div className="text-white/30 text-sm">No events in range</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
                  <th className="text-left pb-2">Date</th>
                  <th className="text-right pb-2">Sessions</th>
                  <th className="text-right pb-2">Page views</th>
                  <th className="text-right pb-2">Events</th>
                </tr>
              </thead>
              <tbody>
                {daily.map(r => (
                  <tr key={r.date} className="border-b border-white/5">
                    <td className="py-2 text-white/70">{r.date}</td>
                    <td className="py-2 text-right">{r.sessions}</td>
                    <td className="py-2 text-right">{r.pageViews}</td>
                    <td className="py-2 text-right">{r.events}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

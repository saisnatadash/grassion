import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'
import { downloadCsv } from '../lib/csv.js'

const PRESETS = [{ label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }]

export function AdminMarketing() {
  const [days, setDays] = useState(30)
  const from = new Date(Date.now() - days * 86400_000).toISOString()
  const to = new Date().toISOString()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-marketing', days],
    queryFn: () => api.adminMarketing({ from, to }),
  })
  if (isLoading) return <Spinner />
  if (!data) return null

  const pageViews = (data.pageViews ?? []) as Array<{ page: string; source: string; views: number; sessions: number }>
  const topReferrers = (data.topReferrers ?? []) as Array<{ referrer: string | null; sessions: number }>
  const events = (data.eventBreakdown ?? []) as Array<{ eventName: string; c: number }>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Marketing</h1>
        <div className="flex gap-2">
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => setDays(p.days)}
              className={`px-3 py-1 text-sm rounded ${days === p.days ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white'}`}>
              {p.label}
            </button>
          ))}
          <button onClick={() => downloadCsv(pageViews, ['page', 'source', 'views', 'sessions'], 'page-views.csv')}
            className="px-3 py-1 text-sm text-white/40 hover:text-white border border-white/20 rounded ml-2">CSV</button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Top pages</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead><tr className="text-white/40 text-xs uppercase border-b border-white/10">
                <th className="text-left pb-2">Page</th>
                <th className="text-left pb-2">Source</th>
                <th className="text-right pb-2">Views</th>
                <th className="text-right pb-2">Sessions</th>
              </tr></thead>
              <tbody>
                {pageViews.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-b border-white/5">
                    <td className="py-1.5 text-white/70 max-w-[160px] truncate">{r.page}</td>
                    <td className="py-1.5 text-white/40 text-xs">{r.source}</td>
                    <td className="py-1.5 text-right">{r.views}</td>
                    <td className="py-1.5 text-right">{r.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Top referrers</CardTitle></CardHeader>
          <CardContent>
            {topReferrers.length === 0 ? (
              <div className="text-white/30 text-sm">No referrer data yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-white/40 text-xs uppercase border-b border-white/10">
                  <th className="text-left pb-2">Referrer</th>
                  <th className="text-right pb-2">Sessions</th>
                </tr></thead>
                <tbody>
                  {topReferrers.map((r, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1.5 text-white/70 max-w-[200px] truncate">{r.referrer ?? 'direct'}</td>
                      <td className="py-1.5 text-right">{r.sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Event breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {events.map(e => (
              <div key={e.eventName} className="text-sm">
                <span className="text-white/50 font-mono">{e.eventName}</span>
                <span className="ml-2 font-semibold">{e.c}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

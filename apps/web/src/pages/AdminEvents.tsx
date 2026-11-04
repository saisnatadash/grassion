import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { Button, Card, CardContent, Input, Spinner } from '../components/ui.js'
import { downloadCsv } from '../lib/csv.js'

export function AdminEvents() {
  const [days, setDays] = useState(7)
  const [source, setSource] = useState('')
  const [eventName, setEventName] = useState('')
  const [page, setPage] = useState(1)
  const from = new Date(Date.now() - days * 86400_000).toISOString()
  const to = new Date().toISOString()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-events', days, source, eventName, page],
    queryFn: () => api.adminEvents({ from, to, source, event_name: eventName, page }),
  })

  const events = (data?.events ?? []) as Array<Record<string, unknown>>
  const total = (data?.total ?? 0) as number
  const limit = 100

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Events Explorer</h1>
        <div className="flex gap-2">
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => { setDays(d); setPage(1) }}
              className={`px-3 py-1 text-sm rounded ${days === d ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white'}`}>
              {d}d
            </button>
          ))}
          <button onClick={() => downloadCsv(events, ['occurredAt', 'sessionId', 'source', 'eventName', 'page', 'referrer'], 'events.csv')}
            className="px-3 py-1 text-sm text-white/40 hover:text-white border border-white/20 rounded ml-2">CSV</button>
        </div>
      </div>
      <div className="flex gap-2">
        <select value={source} onChange={e => { setSource(e.target.value); setPage(1) }}
          className="bg-white/5 border border-white/20 rounded px-3 py-1.5 text-sm text-white w-36">
          <option value="">All sources</option>
          <option value="marketing">marketing</option>
          <option value="app">app</option>
        </select>
        <Input value={eventName} onChange={e => { setEventName(e.target.value); setPage(1) }} placeholder="Event name…" className="w-48" />
      </div>
      {isLoading ? <Spinner /> : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/40 text-xs uppercase tracking-wider">
                  <th className="text-left p-3">When</th>
                  <th className="text-left p-3">Source</th>
                  <th className="text-left p-3">Event</th>
                  <th className="text-left p-3">Page</th>
                  <th className="text-left p-3">Session</th>
                  <th className="text-left p-3">Referrer</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={String(e.id)} className="border-b border-white/5 hover:bg-white/5">
                    <td className="p-3 text-white/40 text-xs">{new Date(String(e.occurredAt)).toLocaleString()}</td>
                    <td className="p-3 text-white/50 text-xs font-mono">{String(e.source)}</td>
                    <td className="p-3 text-white/70 font-mono text-xs">{String(e.eventName)}</td>
                    <td className="p-3 text-white/60 text-xs max-w-[180px] truncate">{String(e.page)}</td>
                    <td className="p-3 text-white/30 text-xs font-mono">{String(e.sessionId).slice(0, 8)}…</td>
                    <td className="p-3 text-white/30 text-xs max-w-[120px] truncate">{String(e.referrer ?? '—')}</td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr><td colSpan={6} className="p-4 text-white/30 text-sm text-center">No events in range</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      <div className="flex items-center justify-between text-sm text-white/40">
        <span>{total.toLocaleString()} total events</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>Prev</Button>
          <Button variant="secondary" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * limit >= total}>Next</Button>
        </div>
      </div>
    </div>
  )
}

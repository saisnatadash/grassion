import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'

export function AdminRevenue() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-revenue'], queryFn: api.adminRevenue })
  if (isLoading) return <Spinner />
  if (!data) return null

  const byPlan = (data.byPlan ?? []) as Array<{ plan: string; count: number; estimatedMrr: number }>
  const totalMrr = byPlan.reduce((s, r) => s + (Number(r.estimatedMrr) || 0), 0)
  const totalPaid = byPlan.reduce((s, r) => s + (Number(r.count) || 0), 0)
  const conversions = (data.recentConversions ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Revenue</h1>
      <div className="grid grid-cols-2 gap-4">
        <Card><CardContent className="pt-5">
          <div className="text-2xl font-semibold">${totalMrr.toFixed(0)}</div>
          <div className="text-sm text-white/50">Estimated MRR</div>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="text-2xl font-semibold">{totalPaid}</div>
          <div className="text-sm text-white/50">Paid teams</div>
        </CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle>MRR by plan</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
                <th className="text-left pb-2">Plan</th>
                <th className="text-right pb-2">Teams</th>
                <th className="text-right pb-2">Est. MRR</th>
              </tr>
            </thead>
            <tbody>
              {byPlan.map(r => (
                <tr key={r.plan} className="border-b border-white/5">
                  <td className="py-2 font-mono text-white/70">{r.plan}</td>
                  <td className="py-2 text-right">{r.count}</td>
                  <td className="py-2 text-right">${Number(r.estimatedMrr).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {conversions.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Recent referral conversions</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs uppercase border-b border-white/10">
                  <th className="text-left pb-2">Team</th>
                  <th className="text-left pb-2">Plan</th>
                  <th className="text-right pb-2">MRR</th>
                  <th className="text-right pb-2">Commission</th>
                  <th className="text-left pb-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {conversions.slice(0, 10).map((c) => (
                  <tr key={String(c.id)} className="border-b border-white/5">
                    <td className="py-2 font-mono text-xs text-white/50">{String(c.teamId ?? '').slice(0, 8)}…</td>
                    <td className="py-2 text-white/70">{String(c.planAtConversion)}</td>
                    <td className="py-2 text-right">${Number(c.mrrUsd).toFixed(0)}</td>
                    <td className="py-2 text-right text-green-400">${Number(c.commissionUsd).toFixed(0)}</td>
                    <td className="py-2 text-white/40 text-xs">{new Date(String(c.convertedAt)).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

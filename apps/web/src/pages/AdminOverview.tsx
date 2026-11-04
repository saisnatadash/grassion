import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-2xl font-semibold text-white">{value}</div>
        <div className="text-sm text-white/50 mt-1">{label}</div>
        {sub && <div className="text-xs text-white/30 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  )
}

export function AdminOverview() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-overview'], queryFn: api.adminOverview })

  if (isLoading) return <Spinner />
  if (!data) return <div className="text-white/50">No data</div>

  const plans = data.teamsByPlan as Record<string, number>
  const paid = (plans['pro'] ?? 0) + (plans['business'] ?? 0) + (plans['enterprise'] ?? 0) +
    (plans['team'] ?? 0) + (plans['growth'] ?? 0) + (plans['starter'] ?? 0)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Total teams" value={data.totalTeams} />
        <Stat label="Paid teams" value={paid} sub={`of ${data.totalTeams} total`} />
        <Stat label="New teams (7d)" value={data.newTeams7d} />
        <Stat label="Total users" value={data.totalUsers} />
        <Stat label="Page views (7d)" value={data.pageViews7d} />
        <Stat label="Contact new" value={data.contactNew} />
        <Stat label="Careers new" value={data.careersNew} />
        <Stat label="LLM spend today" value={`$${Number(data.llmSpendToday).toFixed(2)}`} sub={`$${Number(data.llmSpendMtd).toFixed(2)} MTD`} />
      </div>
      <Card>
        <CardHeader><CardTitle>Teams by plan</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {Object.entries(plans).sort((a, b) => b[1] - a[1]).map(([plan, c]) => (
              <div key={plan} className="text-sm">
                <span className="text-white/50 font-mono">{plan}</span>
                <span className="ml-2 text-white font-semibold">{c}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

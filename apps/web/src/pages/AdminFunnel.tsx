import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'

export function AdminFunnel() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-funnel'], queryFn: api.adminFunnel })
  if (isLoading) return <Spinner />
  if (!data) return null

  const steps = data.funnel as Array<{ label: string; count: number }>
  const max = steps[0]?.count ?? 1

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Conversion Funnel</h1>
      <Card>
        <CardHeader><CardTitle>Team activation funnel</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {steps.map((step, i) => {
              const pct = max > 0 ? (step.count / max) * 100 : 0
              const dropPct = i > 0 && steps[i - 1]!.count > 0
                ? Math.round((1 - step.count / steps[i - 1]!.count) * 100)
                : 0
              return (
                <div key={step.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-white/70">{step.label}</span>
                    <span className="font-semibold text-white">
                      {step.count}
                      {i > 0 && <span className="ml-2 text-red-400 text-xs">−{dropPct}%</span>}
                    </span>
                  </div>
                  <div className="h-2 bg-white/10 rounded">
                    <div className="h-2 bg-white/60 rounded transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

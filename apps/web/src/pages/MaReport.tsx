import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'

function RiskBadge({ level }: { level: 'HIGH' | 'MEDIUM' | 'LOW' | 'DARK' | 'FRAGILE' | 'AT_RISK' | 'HEALTHY' }) {
  const map = {
    HIGH: 'bg-red-500/15 text-red-400 border-red-500/30',
    DARK: 'bg-red-500/15 text-red-400 border-red-500/30',
    FRAGILE: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    AT_RISK: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    MEDIUM: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    LOW: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    HEALTHY: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  }
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono border', map[level])}>
      {level}
    </span>
  )
}

function Stat({ label, value, sub, danger }: { label: string; value: string | number; sub?: string; danger?: boolean }) {
  return (
    <div className="flex flex-col gap-1 p-5 border border-[#1e1e1e] rounded-lg bg-[#111]">
      <span className="text-[10px] font-mono uppercase tracking-widest text-[#555]">{label}</span>
      <span className={cn('text-3xl font-light tabular-nums', danger ? 'text-red-400' : 'text-white')}>{value}</span>
      {sub && <span className="text-[11px] text-[#444]">{sub}</span>}
    </div>
  )
}

export function MaReportPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ma-report'],
    queryFn: () => api.hc.maReport(),
    staleTime: 5 * 60_000,
  })

  if (isLoading) return <div className="p-8 text-[#555] text-sm">Computing report…</div>
  if (error) {
    const e = error as { status?: number }
    if (e.status === 403) {
      return (
        <div className="max-w-2xl mx-auto py-24 px-6 text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-xl font-light text-white mb-2">Business or Enterprise plan required</h2>
          <p className="text-sm text-[#555] mb-6">The M&amp;A Readiness Report is available on Business ($1,500/mo) and Enterprise plans. It's the document acquirers ask for during due diligence.</p>
          <a href="/billing" className="inline-block px-5 py-2.5 bg-white text-black text-xs font-mono uppercase tracking-widest rounded hover:opacity-85 transition-opacity">Upgrade plan</a>
        </div>
      )
    }
    return <div className="p-8 text-red-400 text-sm">Failed to load report.</div>
  }
  if (!data) return null

  const { overallHealth, keyRisks, areaBreakdown, generatedAt, teamName } = data

  function handlePrint() { window.print() }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 print:py-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 print:mb-6">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[#555] block mb-2">M&A Readiness Report · {teamName}</span>
          <h1 className="text-2xl font-light text-white">Knowledge Continuity Assessment</h1>
          <p className="text-sm text-[#444] mt-1">Generated {new Date(generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <button
          onClick={handlePrint}
          className="print:hidden px-4 py-2 border border-[#2a2a2a] text-xs font-mono text-[#888] hover:text-white hover:border-[#444] transition-colors rounded"
        >
          Export PDF
        </button>
      </div>

      {/* Health stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        <Stat label="Coverage score" value={`${overallHealth.score}/100`} danger={overallHealth.score < 50} />
        <Stat label="Dark code" value={`${overallHealth.darkPct}%`} sub="zero active reviewers" danger={overallHealth.darkPct > 20} />
        <Stat label="Single-person" value={`${overallHealth.singleCoveragePct}%`} sub="one reviewer only" danger={overallHealth.singleCoveragePct > 30} />
        <Stat
          label="Bus factor"
          value={overallHealth.busFactor >= 999 ? '∞' : overallHealth.busFactor}
          sub={overallHealth.busFactor >= 999 ? 'resilient' : `${overallHealth.busFactor} key ${overallHealth.busFactor === 1 ? 'person' : 'people'}`}
          danger={overallHealth.busFactor <= 2}
        />
      </div>

      {/* Key risks */}
      {keyRisks.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xs font-mono uppercase tracking-widest text-[#555] mb-4">Offboarding risk — people who would leave critical gaps</h2>
          <div className="border border-[#1e1e1e] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e1e1e] bg-[#111]">
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">Person</th>
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">Sole coverage</th>
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">Risk</th>
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">Areas at risk (sample)</th>
                </tr>
              </thead>
              <tbody>
                {keyRisks.map((r) => (
                  <tr key={r.personLogin} className="border-b border-[#141414] last:border-0 hover:bg-white/2">
                    <td className="px-4 py-3 font-mono text-xs text-white">@{r.personLogin}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[#888]">{r.aloneCoversCount} area{r.aloneCoversCount !== 1 ? 's' : ''}</td>
                    <td className="px-4 py-3"><RiskBadge level={r.riskLevel} /></td>
                    <td className="px-4 py-3 text-[11px] text-[#555] font-mono">
                      {r.aloneCoversAreas.slice(0, 3).map((a) => a.path).join(', ')}
                      {r.aloneCoversAreas.length > 3 && ` +${r.aloneCoversAreas.length - 3} more`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Area breakdown */}
      {areaBreakdown.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xs font-mono uppercase tracking-widest text-[#555] mb-4">Code area heat map — highest risk first</h2>
          <div className="border border-[#1e1e1e] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e1e1e] bg-[#111]">
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">Area</th>
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">Repo</th>
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">Status</th>
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-[#555]">Reviewers</th>
                </tr>
              </thead>
              <tbody>
                {areaBreakdown.map((a) => (
                  <tr key={`${a.repoName}/${a.path}`} className="border-b border-[#141414] last:border-0 hover:bg-white/2">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#ccc]">
                      {a.path}
                      {a.isCritical && <span className="ml-2 text-[9px] text-red-400 font-mono border border-red-500/30 px-1 py-0.5 rounded">CRITICAL</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-[#555] font-mono">{a.repoName}</td>
                    <td className="px-4 py-2.5"><RiskBadge level={a.riskLevel as Parameters<typeof RiskBadge>[0]['level']} /></td>
                    <td className="px-4 py-2.5 text-[11px] text-[#666] font-mono">
                      {a.activePeopleLogins.length === 0 ? '—' : a.activePeopleLogins.map((l) => `@${l}`).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Print footer */}
      <div className="hidden print:block mt-8 pt-4 border-t border-[#1e1e1e] text-[10px] text-[#555] font-mono">
        Generated by Grassion · app.grassion.com · {teamName} · {new Date(generatedAt).toISOString()}
      </div>
    </div>
  )
}

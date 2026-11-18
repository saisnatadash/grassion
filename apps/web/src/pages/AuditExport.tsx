import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Shield, FileText, AlertTriangle, CheckCircle, Lock } from 'lucide-react'
import { api, type AuditExportEntry } from '../lib/api.js'
import { Spinner, Badge, Button } from '../components/ui.js'
import { cn } from '../lib/utils.js'
import { usePlan } from '../lib/plan.js'

function isoToDateInput(iso: string) {
  return iso.slice(0, 10)
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium' })
}

function entriesToCsv(entries: AuditExportEntry[]): string {
  const header = ['PR#', 'Title', 'Author', 'Merged At', 'AI Tool', 'AI Confidence', 'Reviews', 'Attested', 'Attestors', 'Check Result', 'Additions', 'Deletions']
  const rows = entries.map((e) => [
    e.prNumber,
    `"${(e.title ?? '').replace(/"/g, '""')}"`,
    e.authorLogin ?? '',
    e.mergedAt ? new Date(e.mergedAt).toISOString() : '',
    e.aiSource ?? '',
    e.isAiHeavy ? `${Math.round(e.aiConfidence * 100)}%` : '',
    e.reviewCount,
    e.hasAttestation ? 'Yes' : 'No',
    e.attestations.map((a) => `${a.personLogin}:${a.answer}`).join('; '),
    e.checkConclusion ?? '',
    e.additions,
    e.deletions,
  ])
  return [header, ...rows].map((r) => r.join(',')).join('\n')
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function AuditExportPage() {
  const now = new Date()
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const [from, setFrom] = useState(isoToDateInput(ninetyDaysAgo.toISOString()))
  const [to, setTo] = useState(isoToDateInput(now.toISOString()))
  const printRef = useRef<HTMLDivElement>(null)
  const { isFree, isLoading: planLoading } = usePlan()

  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })
  const repoId = repos.data?.[0]?.id ?? ''

  const exportQ = useQuery({
    queryKey: ['audit-export', repoId, from, to],
    queryFn: () => api.hc.auditExport(repoId, { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` }),
    enabled: !!repoId && !isFree,
  })

  const data = exportQ.data

  function handleCsvDownload() {
    if (!data) return
    const csv = entriesToCsv(data.entries)
    downloadCsv(csv, `grassion-audit-${from}_${to}.csv`)
  }

  function handlePdfPrint() {
    window.print()
  }

  if (repos.isLoading || planLoading) return <div className="flex justify-center p-12"><Spinner /></div>
  if (!repoId) {
    return (
      <div className="text-center py-16 text-[#666]">
        <Shield className="mx-auto mb-4 w-10 h-10 opacity-30" />
        <p>Connect a repo to generate an audit export.</p>
      </div>
    )
  }

  if (isFree) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-[#4f8ef7]" />
            Audit Export
          </h1>
          <p className="mt-1 text-sm text-[#888]">Merge Receipt audit log for compliance and change-management evidence</p>
        </div>
        <div className="rounded-xl border border-[#333] bg-[#111] p-8 text-center space-y-4">
          <Lock className="mx-auto w-10 h-10 text-[#555]" />
          <h2 className="text-lg font-semibold text-white">Team plan required</h2>
          <p className="text-sm text-[#888] max-w-md mx-auto">
            Audit Export is included in the Team plan. Export date-range CSVs and PDFs for compliance evidence, SOC 2, or change-management audits.
          </p>
          <a
            href="https://grassion.com/pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-5 py-2.5 text-sm font-medium hover:bg-white/90 transition-colors"
          >
            Upgrade to Team for $99/mo
          </a>
          <p className="text-xs text-[#555]">Up to 25 developers · All repos · Full receipt history</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={printRef} className="space-y-6 print:text-black print:bg-white">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap print:block">
        <div>
          <h1 className="text-2xl font-semibold text-white print:text-black flex items-center gap-2">
            <Shield className="w-6 h-6 text-[#4f8ef7] print:hidden" />
            Audit Export
          </h1>
          <p className="mt-1 text-sm text-[#888] print:text-gray-600">
            Merge Receipt audit log for compliance and change-management evidence
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="secondary" size="sm" onClick={handleCsvDownload} disabled={!data}>
            <Download className="w-4 h-4 mr-1" /> CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={handlePdfPrint} disabled={!data}>
            <FileText className="w-4 h-4 mr-1" /> PDF
          </Button>
        </div>
      </div>

      {/* Date range selector */}
      <div className="flex gap-3 items-end flex-wrap print:hidden">
        <div>
          <label className="block text-xs text-[#666] mb-1">From</label>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-[#1a1a1a] border border-[#333] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4f8ef7]"
          />
        </div>
        <div>
          <label className="block text-xs text-[#666] mb-1">To</label>
          <input
            type="date"
            value={to}
            min={from}
            max={isoToDateInput(now.toISOString())}
            onChange={(e) => setTo(e.target.value)}
            className="bg-[#1a1a1a] border border-[#333] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4f8ef7]"
          />
        </div>
      </div>

      {exportQ.isLoading && <div className="flex justify-center p-8"><Spinner /></div>}

      {data && (
        <>
          {/* Compliance label */}
          <div className="bg-blue-950/20 border border-blue-800/30 rounded-xl px-4 py-3 text-xs text-blue-300">
            <Shield className="w-3.5 h-3.5 inline mr-1.5" />
            {data.summary.complianceLabel}
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total PRs', value: data.summary.totalPrs },
              { label: 'AI-heavy PRs', value: `${data.summary.aiHeavyPrs} (${data.summary.aiHeavyPct}%)` },
              { label: 'Attested', value: `${data.summary.attestedPrs} (${data.summary.attestedPct}%)` },
              { label: 'Exceptions', value: data.summary.exceptions, alert: data.summary.exceptions > 0 },
            ].map(({ label, value, alert }) => (
              <div key={label} className={cn(
                'rounded-xl border p-4',
                alert ? 'border-red-800/40 bg-red-950/20' : 'border-[#222] bg-[#111]',
              )}>
                <div className="text-xs text-[#666] mb-1">{label}</div>
                <div className={cn('text-xl font-semibold', alert ? 'text-red-300' : 'text-white')}>{value}</div>
              </div>
            ))}
          </div>

          {/* Period */}
          <div className="text-xs text-[#555]">
            Period: {formatDate(data.period.from)} – {formatDate(data.period.to)} ·
            Repo: {data.repo.owner}/{data.repo.name} ·
            Generated: {new Date(data.generatedAt).toLocaleString()}
          </div>

          {/* Entries table (sample of 25 or all) */}
          <div>
            <h2 className="text-sm font-semibold text-[#aaa] uppercase tracking-wide mb-3">
              {data.entries.length <= 25 ? `All ${data.entries.length} PRs` : `Random sample of 25 PRs`}
            </h2>
            <div className="rounded-xl border border-[#222] overflow-auto">
              <table className="w-full text-xs min-w-[600px]">
                <thead className="bg-[#141414] text-[#555] uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-2">PR</th>
                    <th className="text-left px-4 py-2">Author</th>
                    <th className="text-left px-4 py-2">AI Tool</th>
                    <th className="text-left px-4 py-2">Reviews</th>
                    <th className="text-left px-4 py-2">Attestation</th>
                    <th className="text-left px-4 py-2">Check</th>
                    <th className="text-left px-4 py-2">Merged</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a1a1a]">
                  {(data.entries.length <= 25 ? data.entries : data.sample).map((e) => (
                    <tr key={e.prNumber} className={cn('hover:bg-[#141414]', e.noReview || (e.isAiHeavy && !e.hasAttestation) ? 'bg-red-950/10' : '')}>
                      <td className="px-4 py-2">
                        <div className="font-medium text-white">#{e.prNumber}</div>
                        <div className="text-[#555] truncate max-w-[180px]">{e.title}</div>
                      </td>
                      <td className="px-4 py-2 text-[#888]">{e.authorLogin ?? '—'}</td>
                      <td className="px-4 py-2">
                        {e.isAiHeavy
                          ? <Badge className="bg-blue-900/40 text-blue-300 border-blue-700/50 text-[10px]">{e.aiSource}</Badge>
                          : <span className="text-[#444]">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        {e.noReview
                          ? <span className="text-red-400">None</span>
                          : <span className="text-[#888]">{e.reviewCount}</span>}
                      </td>
                      <td className="px-4 py-2">
                        {e.hasAttestation
                          ? <span className="text-green-400">{e.attestations.map((a) => `${a.personLogin}`).join(', ')}</span>
                          : <span className={cn(e.isAiHeavy ? 'text-yellow-400' : 'text-[#444]')}>
                              {e.isAiHeavy ? 'None' : '—'}
                            </span>}
                      </td>
                      <td className="px-4 py-2">
                        {e.checkConclusion === 'success' && <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
                        {e.checkConclusion === 'action_required' && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
                        {e.checkConclusion === 'neutral' && <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />}
                        {!e.checkConclusion && <span className="text-[#333]">—</span>}
                      </td>
                      <td className="px-4 py-2 text-[#666]">{formatDate(e.mergedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.entries.length > 25 && (
              <div className="text-xs text-[#555] mt-2 text-right">
                Showing random sample of 25 / {data.entries.length} PRs. Download CSV for the full set.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

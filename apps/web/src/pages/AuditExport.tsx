import { useState, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Shield, FileText, AlertTriangle, CheckCircle, Lock, CheckCircle2, XCircle } from 'lucide-react'
import { api, type AuditExportEntry } from '../lib/api.js'
import { Spinner, Badge, Button } from '../components/ui.js'
import { cn } from '../lib/utils.js'
import { usePlan } from '../lib/plan.js'

type ChainResult = { valid: boolean; checkedPrs: number; totalAttestations: number; checkedAt: string }

function isoToDateInput(iso: string) {
  return iso.slice(0, 10)
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  // Use date-only portion at noon UTC to avoid timezone shift when displaying period bounds
  const datePart = iso.slice(0, 10)
  return new Date(`${datePart}T12:00:00Z`).toLocaleDateString('en-GB', { dateStyle: 'medium' })
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

const PAGE_SIZE = 25

export function AuditExportPage() {
  const now = new Date()
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const [from, setFrom] = useState(isoToDateInput(ninetyDaysAgo.toISOString()))
  const [to, setTo] = useState(isoToDateInput(now.toISOString()))
  const [page, setPage] = useState(0)
  const [chainResult, setChainResult] = useState<ChainResult | null>(null)
  const [verifying, setVerifying] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)
  const { isFree, isLoading: planLoading } = usePlan()

  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })
  const repoId = repos.data?.[0]?.id ?? ''

  // Reset to first page and clear chain result when date range or repo changes
  useMemo(() => { setPage(0); setChainResult(null) }, [from, to, repoId])  // eslint-disable-line react-hooks/exhaustive-deps

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

  async function handleVerifyAndPrint() {
    if (!repoId) return
    setVerifying(true)
    try {
      const result = await api.hc.auditVerify(repoId, `${from}T00:00:00Z`, `${to}T23:59:59Z`)
      setChainResult(result)
      // Small delay so React re-renders the chain result before the browser's print dialog opens
      setTimeout(() => window.print(), 200)
    } catch {
      window.print()
    } finally {
      setVerifying(false)
    }
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
          <Button variant="secondary" size="sm" onClick={handleVerifyAndPrint} disabled={!data || verifying}>
            <FileText className="w-4 h-4 mr-1" /> {verifying ? 'Verifying…' : 'PDF'}
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

      {exportQ.isError && (
        <div className="rounded-xl border border-red-800/40 bg-red-950/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="w-4 h-4 inline mr-2" />
          Could not load audit data. Make sure the repo has been synced and try again.
        </div>
      )}

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

          {/* Report header — visible in print */}
          <div className="hidden print:block mb-6">
            <div className="text-2xl font-bold text-black">Audit Period Report</div>
            <div className="mt-1 text-sm text-gray-600">
              {data.repo.owner}/{data.repo.name} · {formatDate(data.period.from)} – {formatDate(data.period.to)}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">Generated {new Date(data.generatedAt).toLocaleString()}</div>
          </div>

          {/* Period */}
          <div className="text-xs text-[#555] print:hidden">
            Period: {formatDate(data.period.from)} – {formatDate(data.period.to)} ·
            Repo: {data.repo.owner}/{data.repo.name} ·
            Generated: {new Date(data.generatedAt).toLocaleString()}
          </div>

          {/* Chain verification result — shown when verified, also in print */}
          {chainResult && (
            <div className={cn(
              'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
              chainResult.valid
                ? 'bg-green-950/30 border-green-800/40 text-green-300 print:bg-green-50 print:border-green-200 print:text-green-800'
                : 'bg-red-950/30 border-red-800/40 text-red-300 print:bg-red-50 print:border-red-200 print:text-red-800',
            )}>
              {chainResult.valid
                ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
              <div>
                <div className="font-medium">
                  {chainResult.valid
                    ? `Chain intact — ${chainResult.totalAttestations} attestation${chainResult.totalAttestations !== 1 ? 's' : ''} across ${chainResult.checkedPrs} PR${chainResult.checkedPrs !== 1 ? 's' : ''} verified`
                    : 'Chain verification failed — potential tampering detected'}
                </div>
                <div className="mt-0.5 text-xs opacity-70">
                  Verified {new Date(chainResult.checkedAt).toLocaleString()}
                </div>
              </div>
            </div>
          )}

          {/* Entries table with pagination */}
          {(() => {
            const totalPages = Math.max(1, Math.ceil(data.entries.length / PAGE_SIZE))
            const safePage = Math.min(page, totalPages - 1)
            const pageEntries = data.entries.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
            return (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-[#aaa] uppercase tracking-wide">
                    All {data.entries.length} PRs
                  </h2>
                  {totalPages > 1 && (
                    <span className="text-xs text-[#555]">
                      Page {safePage + 1} of {totalPages}
                    </span>
                  )}
                </div>
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
                      {pageEntries.map((e) => (
                        <tr key={e.prNumber} className={cn('hover:bg-[#141414]', e.noReview && !e.hasAttestation ? 'bg-red-950/10' : '')}>
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
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-3">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      className="px-3 py-1.5 text-xs rounded-lg border border-[#333] text-[#888] hover:text-white hover:border-[#555] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-[#555]">
                      {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, data.entries.length)} of {data.entries.length}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={safePage >= totalPages - 1}
                      className="px-3 py-1.5 text-xs rounded-lg border border-[#333] text-[#888] hover:text-white hover:border-[#555] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Signature line — print only */}
          <div className="hidden print:block mt-12 pt-6 border-t border-gray-200">
            <div className="grid grid-cols-2 gap-12">
              <div>
                <div className="text-xs text-gray-400 mb-6">Prepared by</div>
                <div className="border-b border-gray-400 mb-1" style={{ minWidth: '200px' }} />
                <div className="text-xs text-gray-500">Name / Title</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-6">Reviewed by</div>
                <div className="border-b border-gray-400 mb-1" style={{ minWidth: '200px' }} />
                <div className="text-xs text-gray-500">Name / Title</div>
              </div>
            </div>
            <div className="mt-6 text-[10px] text-gray-400">
              This report was generated by Grassion. Attestation records are stored in an
              append-only SHA-256 hash chain and cannot be retroactively altered.
              {chainResult && ` Chain verified ${new Date(chainResult.checkedAt).toLocaleString()}.`}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

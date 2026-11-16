import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileText, Shield, AlertTriangle, CheckCircle, ChevronRight, Filter } from 'lucide-react'
import { api } from '../lib/api.js'
import { Spinner, Badge } from '../components/ui.js'
import { cn } from '../lib/utils.js'

function answerBadge(count: number, isAiHeavy: boolean) {
  if (count > 0) return <Badge className="bg-green-900/40 text-green-300 border-green-700/50">✓ Attested ({count})</Badge>
  if (isAiHeavy) return <Badge className="bg-yellow-900/40 text-yellow-300 border-yellow-700/50">⚠ Needs attestation</Badge>
  return <Badge className="bg-[#2a2a2a] text-[#888] border-[#333]">No attestation</Badge>
}

export function ReceiptsListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const aiHeavy = searchParams.get('aiHeavy') === 'true'
  const noAttestation = searchParams.get('noAttestation') === 'true'
  const noReview = searchParams.get('noReview') === 'true'
  const navigate = useNavigate()

  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })
  const repoIdParam = searchParams.get('repo')
  const repoId = repoIdParam ?? repos.data?.[0]?.id ?? ''

  const list = useQuery({
    queryKey: ['receipts', repoId, aiHeavy, noAttestation, noReview],
    queryFn: () => api.hc.receipts(repoId, { aiHeavy, noAttestation, noReview }),
    enabled: !!repoId,
  })

  function toggle(key: string, value: boolean) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, 'true')
    else next.delete(key)
    setSearchParams(next)
  }

  if (repos.isLoading || list.isLoading) {
    return <div className="flex justify-center p-12"><Spinner /></div>
  }
  if (!repoId) {
    return (
      <div className="text-center py-16 text-[#666]">
        <Shield className="mx-auto mb-4 w-10 h-10 opacity-30" />
        <p>Connect a repo to see Merge Receipts.</p>
      </div>
    )
  }

  const items = list.data?.items ?? []
  const repo = list.data?.repo

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-[#4f8ef7]" />
            Merge Receipts
          </h1>
          <p className="mt-1 text-sm text-[#888]">
            {repo ? `${repo.owner}/${repo.name}` : ''} — permanent record of every human review decision
          </p>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <Filter className="w-4 h-4 text-[#666]" />
          {[
            { key: 'aiHeavy', label: 'AI-heavy', active: aiHeavy },
            { key: 'noAttestation', label: 'Needs attestation', active: noAttestation },
            { key: 'noReview', label: 'No review', active: noReview },
          ].map(({ key, label, active }) => (
            <button
              key={key}
              onClick={() => toggle(key, !active)}
              className={cn(
                'px-3 py-1 text-xs rounded-full border transition-colors',
                active
                  ? 'bg-[#4f8ef7]/20 border-[#4f8ef7]/50 text-[#4f8ef7]'
                  : 'bg-[#1a1a1a] border-[#333] text-[#666] hover:text-[#aaa]',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 text-[#666]">
          <FileText className="mx-auto mb-4 w-10 h-10 opacity-30" />
          <p>{list.data ? 'No PRs match the current filters.' : 'No merged PRs found yet.'}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-[#222] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#141414] text-[#666] text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">PR</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Author</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">AI Tool</th>
                <th className="text-left px-4 py-3">Attestation</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Check</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1a1a]">
              {items.map((item) => (
                <tr
                  key={item.prNumber}
                  className="hover:bg-[#141414] cursor-pointer transition-colors"
                  onClick={() => navigate(`/receipts/${item.prNumber}?repo=${repoId}`)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">#{item.prNumber}</div>
                    <div className="text-[#666] truncate max-w-[200px] text-xs">{item.title}</div>
                  </td>
                  <td className="px-4 py-3 text-[#888] hidden sm:table-cell">{item.authorLogin ?? '—'}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {item.isAiHeavy ? (
                      <Badge className="bg-blue-900/40 text-blue-300 border-blue-700/50">{item.aiSource ?? 'AI'}</Badge>
                    ) : (
                      <span className="text-[#555]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{answerBadge(item.attestationCount, item.isAiHeavy)}</td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {item.checkConclusion === 'success' && <CheckCircle className="w-4 h-4 text-green-400" />}
                    {item.checkConclusion === 'action_required' && <AlertTriangle className="w-4 h-4 text-red-400" />}
                    {item.checkConclusion === 'neutral' && <AlertTriangle className="w-4 h-4 text-yellow-400" />}
                    {!item.checkConclusion && <span className="text-[#444]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="w-4 h-4 text-[#555] inline-block" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

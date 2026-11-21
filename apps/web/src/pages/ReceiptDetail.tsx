import { useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  FileText, CheckCircle, AlertTriangle, Shield, ArrowLeft,
  User, GitMerge, Clock, Lock, Unlock, RefreshCw,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { Spinner, Badge, Button } from '../components/ui.js'
import { cn } from '../lib/utils.js'

function answerLabel(answer: string) {
  if (answer === 'understand') return { label: 'I understand this', color: 'text-green-300 bg-green-900/40 border-green-700/50' }
  if (answer === 'partly') return { label: 'Partly', color: 'text-yellow-300 bg-yellow-900/40 border-yellow-700/50' }
  return { label: "AI wrote it, didn't fully review", color: 'text-orange-300 bg-orange-900/40 border-orange-700/50' }
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export function ReceiptDetailPage() {
  const { prNumber: prStr } = useParams<{ prNumber: string }>()
  const [searchParams] = useSearchParams()
  const prNumber = parseInt(prStr ?? '0', 10)
  const [verifyState, setVerifyState] = useState<{ loading: boolean; result: { valid: boolean; rowCount: number; checkedAt: string } | null }>({ loading: false, result: null })

  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })
  const repoIdParam = searchParams.get('repo')
  const repoId = repoIdParam ?? repos.data?.[0]?.id ?? ''

  const receipt = useQuery({
    queryKey: ['receipt', repoId, prNumber],
    queryFn: () => api.hc.receipt(repoId, prNumber),
    enabled: !!repoId && !isNaN(prNumber),
  })

  async function runVerify() {
    if (!repoId) return
    setVerifyState({ loading: true, result: null })
    try {
      const r = await api.hc.verifyChain(repoId, prNumber)
      setVerifyState({ loading: false, result: { ...r, checkedAt: new Date().toISOString() } })
    } catch {
      setVerifyState({ loading: false, result: null })
    }
  }

  if (repos.isLoading || receipt.isLoading) {
    return <div className="flex justify-center p-12"><Spinner /></div>
  }

  if (receipt.isError || !receipt.data) {
    return (
      <div className="text-center py-16 text-[#666]">
        <FileText className="mx-auto mb-4 w-10 h-10 opacity-30" />
        <p>Receipt not found for PR #{prNumber}.</p>
        <Link to="/receipts" className="mt-4 inline-block text-sm text-[#4f8ef7] hover:underline">← All receipts</Link>
      </div>
    )
  }

  const { pr, checkRun, attestations, chainValid, chainRowCount } = receipt.data

  const isAiHeavy = pr.aiSource != null && pr.aiConfidence >= 0.5
  const conclusionColor = checkRun?.conclusion === 'success'
    ? 'text-green-400' : checkRun?.conclusion === 'action_required'
    ? 'text-red-400' : 'text-yellow-400'

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back link */}
      <Link to="/receipts" className="text-sm text-[#555] hover:text-[#aaa] flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> All receipts
      </Link>

      {/* Header */}
      <div className="bg-[#111] border border-[#222] rounded-xl p-6">
        <div className="flex items-start gap-3">
          <FileText className="w-6 h-6 text-[#4f8ef7] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-white leading-tight">
              #{pr.number}: {pr.title}
            </h1>
            <div className="mt-2 flex flex-wrap gap-3 text-sm text-[#888]">
              <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" />{pr.authorLogin ?? '—'}</span>
              <span className="flex items-center gap-1"><GitMerge className="w-3.5 h-3.5" />{pr.repoOwner}/{pr.repoName}</span>
              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Merged {formatDate(pr.mergedAt)}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {isAiHeavy && (
                <Badge className="bg-blue-900/40 text-blue-300 border-blue-700/50">
                  AI: {pr.aiSource} ({Math.round(pr.aiConfidence * 100)}% confidence)
                </Badge>
              )}
              {pr.aiDetectionMethod && (
                <Badge className="bg-[#1a1a1a] text-[#888] border-[#333]">
                  Detected via {pr.aiDetectionMethod}
                </Badge>
              )}
              <Badge className="bg-[#1a1a1a] text-[#888] border-[#333]">
                +{pr.additions} / -{pr.deletions} · {pr.changedFiles} files
              </Badge>
              {pr.reviewCount === 0 && (
                <Badge className="bg-red-900/40 text-red-300 border-red-700/50">No reviews</Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Chain integrity */}
      <div className="bg-[#111] border border-[#222] rounded-xl p-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[#aaa] uppercase tracking-wide mb-2">Hash Chain Integrity</h2>
          {verifyState.result ? (
            <div className={cn(
              'flex items-center gap-2 text-sm',
              verifyState.result.valid ? 'text-green-400' : 'text-red-400',
            )}>
              {verifyState.result.valid ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
              <span>
                {verifyState.result.valid
                  ? `Chain intact, ${verifyState.result.rowCount} record${verifyState.result.rowCount !== 1 ? 's' : ''}, checked ${new Date(verifyState.result.checkedAt).toLocaleString()}`
                  : 'Chain verification failed — potential tampering detected'}
              </span>
            </div>
          ) : (
            <div className={cn(
              'flex items-center gap-2 text-sm',
              chainValid ? 'text-green-400' : 'text-red-400',
            )}>
              {chainValid ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
              <span>
                {chainValid
                  ? `Hash chain intact — ${chainRowCount} record${chainRowCount !== 1 ? 's' : ''}`
                  : 'Chain verification failed'}
              </span>
            </div>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={runVerify} disabled={verifyState.loading} className="shrink-0">
          <RefreshCw className={cn('w-3.5 h-3.5 mr-1', verifyState.loading && 'animate-spin')} />
          {verifyState.loading ? 'Verifying…' : 'Verify chain'}
        </Button>
      </div>

      {/* GitHub check run */}
      {checkRun && (
        <div className="bg-[#111] border border-[#222] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[#aaa] uppercase tracking-wide mb-3">GitHub Check Run</h2>
          <div className="flex items-center gap-2">
            {checkRun.conclusion === 'success' && <CheckCircle className={cn('w-5 h-5', conclusionColor)} />}
            {checkRun.conclusion === 'action_required' && <AlertTriangle className={cn('w-5 h-5', conclusionColor)} />}
            {checkRun.conclusion === 'neutral' && <AlertTriangle className={cn('w-5 h-5', conclusionColor)} />}
            <span className="text-white capitalize">{checkRun.conclusion?.replace(/_/g, ' ') ?? 'No conclusion'}</span>
          </div>
          {checkRun.headSha && (
            <div className="mt-2 text-xs text-[#555] font-mono">SHA: {checkRun.headSha.slice(0, 12)}</div>
          )}
        </div>
      )}

      {/* Attestation history */}
      <div className="bg-[#111] border border-[#222] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-[#aaa] uppercase tracking-wide mb-3">
          Attestation History
        </h2>
        {attestations.length === 0 ? (
          <div className="text-sm text-[#555] py-4 text-center">
            No attestations recorded for this PR.
            {isAiHeavy && (
              <div className="mt-1 text-xs text-[#444]">
                Reviewers can click the check-run buttons on the PR to record their review.
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {attestations.map((a, i) => {
              const { label, color } = answerLabel(a.answer)
              return (
                <div key={a.id} className="flex items-start gap-3 p-3 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a]">
                  <div className="w-7 h-7 rounded-full bg-[#222] flex items-center justify-center text-xs text-[#888] shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-medium text-sm">{a.personLogin}</span>
                      <Badge className={cn('text-xs', color)}>{label}</Badge>
                    </div>
                    {a.note && <div className="mt-1 text-xs text-[#666] italic">"{a.note}"</div>}
                    <div className="mt-1 text-xs text-[#444]">{formatDate(a.createdAt)}</div>
                    <div className="mt-1 text-[10px] text-[#333] font-mono break-all">{a.rowHash.slice(0, 32)}…</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Compliance footer */}
      <div className="text-xs text-[#444] border border-[#1a1a1a] rounded-lg px-4 py-3 flex items-start gap-2">
        <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#555]" />
        <span>
          This receipt is a permanent, append-only record. Attestations cannot be deleted or overwritten.
          SHA-256 hash chain verifiable on request.
          Supports change-management evidence (e.g. SOC 2 CC8.1). Does not constitute certification.
        </span>
      </div>
    </div>
  )
}

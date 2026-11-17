import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  FileText, Shield, AlertTriangle, CheckCircle, ChevronRight, Filter,
  Circle, GitPullRequest, Zap, Users, TrendingUp,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { api, type TrendPoint } from '../lib/api.js'
import { useInstallPopup } from '../lib/install-popup.js'
import { Spinner, Badge, Card, CardContent, CardHeader, CardTitle, Button } from '../components/ui.js'
import { cn } from '../lib/utils.js'

// ── Setup checklist ──────────────────────────────────────────────────────────

function SetupItem({
  done, label, hint, linkTo, linkLabel, action,
}: {
  done: boolean
  label: string
  hint: string
  linkTo?: string
  linkLabel?: string
  action?: () => void
}) {
  return (
    <div className="flex items-start gap-3">
      {done
        ? <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
        : <Circle className="h-5 w-5 text-[#444] flex-shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className={cn('text-sm font-medium', done ? 'text-[#555] line-through' : 'text-white')}>{label}</div>
        {!done && (
          <div className="text-xs text-[#555] mt-0.5">
            {hint}
            {action && linkLabel && (
              <button onClick={action} className="ml-1.5 text-blue-400 hover:text-blue-300 underline">{linkLabel}</button>
            )}
            {linkTo && linkLabel && !action && (
              <Link to={linkTo} className="ml-1.5 text-blue-400 hover:text-blue-300 underline">{linkLabel}</Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMonth(iso: string) {
  return new Date(iso + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

function answerBadge(count: number, isAiHeavy: boolean) {
  if (count > 0) return <Badge className="bg-green-900/40 text-green-300 border-green-700/50">✓ {count}</Badge>
  if (isAiHeavy) return <Badge className="bg-yellow-900/40 text-yellow-300 border-yellow-700/50">⚠ Needs attestation</Badge>
  return <Badge className="bg-[#2a2a2a] text-[#888] border-[#333]">—</Badge>
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ReceiptsHomePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { open: openInstall, syncing: installSyncing } = useInstallPopup()

  const aiHeavy = searchParams.get('aiHeavy') === 'true'
  const noAttestation = searchParams.get('noAttestation') === 'true'
  const noReview = searchParams.get('noReview') === 'true'
  const exceptionsOnly = searchParams.get('exceptions') === 'true'

  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })
  const repoIdParam = searchParams.get('repo')
  const repoId = repoIdParam ?? repos.data?.[0]?.id ?? ''

  const team = me.data?.team
  const installed = !!team?.githubInstallationId
  const activeRepos = (repos.data ?? []).filter((r) => r.isActive)
  const checkRunOn = team?.hcCheckRunEnabled ?? false
  const teamSized = !!(team?.teamSizeRange)
  const setupComplete = installed && activeRepos.length > 0 && checkRunOn && teamSized

  // Exceptions: PRs merged without review
  const exceptionsQ = useQuery({
    queryKey: ['receipts', repoId, 'exceptions'],
    queryFn: () => api.hc.receipts(repoId, { noReview: true, limit: 5 }),
    enabled: !!repoId,
    staleTime: 2 * 60 * 1000,
  })

  // Trend data
  const trendQ = useQuery({
    queryKey: ['hc-trend', repoId],
    queryFn: () => api.hc.trend(repoId, 6),
    enabled: !!repoId,
    staleTime: 5 * 60 * 1000,
  })

  // Full receipts list
  const listQ = useQuery({
    queryKey: ['receipts', repoId, aiHeavy, noAttestation, noReview || exceptionsOnly],
    queryFn: () => api.hc.receipts(repoId, {
      aiHeavy,
      noAttestation,
      noReview: noReview || exceptionsOnly,
    }),
    enabled: !!repoId,
  })

  function toggle(key: string, value: boolean) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, 'true')
    else next.delete(key)
    setSearchParams(next)
  }

  if (me.isLoading || repos.isLoading) {
    return <div className="flex justify-center p-12"><Spinner /></div>
  }

  const trendData = (trendQ.data ?? []).map((p: TrendPoint) => ({
    ...p,
    month: fmtMonth(p.month),
  }))

  const exceptionItems = exceptionsQ.data?.items ?? []
  const listItems = listQ.data?.items ?? []
  const repo = listQ.data?.repo ?? exceptionsQ.data?.repo

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
          <FileText className="w-6 h-6 text-[#4f8ef7]" />
          Merge Receipts
        </h1>
        <p className="mt-1 text-sm text-[#888]">
          Proof a human reviewed your AI-written code
          {repo ? ` · ${repo.owner}/${repo.name}` : ''}
        </p>
      </div>

      {/* Get Started — hidden once all 4 steps done */}
      {!setupComplete && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-400" />
              Get started
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SetupItem
              done={installed}
              label="Install the GitHub App"
              hint="Grants read access to your PR history."
              action={!installed ? openInstall : undefined}
              linkLabel={installSyncing ? 'Connecting…' : 'Install on GitHub'}
            />
            <SetupItem
              done={activeRepos.length > 0}
              label="Repositories connected"
              hint="Done automatically after install. Check Settings if repos are missing."
              linkTo="/settings"
              linkLabel="Settings"
            />
            <SetupItem
              done={checkRunOn}
              label="Turn on Merge Receipts check runs"
              hint="Posts a check run on every PR so reviewers can attest."
              linkTo="/settings"
              linkLabel="Enable in Settings"
            />
            <SetupItem
              done={teamSized}
              label="Configure your team"
              hint="Tell us your team size so reports are meaningful."
              linkTo="/settings"
              linkLabel="Go to Settings"
            />
          </CardContent>
        </Card>
      )}

      {/* Only show data sections when a repo is connected */}
      {!repoId ? (
        <div className="text-center py-16 text-[#666]">
          <Shield className="mx-auto mb-4 w-10 h-10 opacity-30" />
          <p>Connect a repo to see Merge Receipts.</p>
        </div>
      ) : (
        <>
          {/* Exceptions banner */}
          {exceptionItems.length > 0 && (
            <div className="rounded-xl border border-red-800/40 bg-red-950/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
                <span className="text-sm font-medium text-red-300">
                  {exceptionItems.length} PR{exceptionItems.length === 1 ? '' : 's'} merged without review
                </span>
                <button
                  onClick={() => toggle('noReview', !noReview)}
                  className="ml-auto text-xs text-red-400 hover:text-red-300 underline"
                >
                  {noReview ? 'Clear filter' : 'Show only these'}
                </button>
              </div>
              <div className="space-y-1.5">
                {exceptionItems.slice(0, 3).map((item) => (
                  <div
                    key={item.prNumber}
                    onClick={() => navigate(`/receipts/${item.prNumber}${repoId ? `?repo=${repoId}` : ''}`)}
                    className="flex items-center gap-3 text-xs text-[#888] cursor-pointer hover:text-white transition-colors"
                  >
                    <GitPullRequest className="h-3 w-3 text-red-400 flex-shrink-0" />
                    <span className="text-red-300 font-medium">#{item.prNumber}</span>
                    <span className="truncate">{item.title}</span>
                    <span className="ml-auto text-[#555] flex-shrink-0">{item.authorLogin}</span>
                  </div>
                ))}
                {exceptionItems.length > 3 && (
                  <p className="text-xs text-[#555] pt-1">+{exceptionItems.length - 3} more</p>
                )}
              </div>
            </div>
          )}

          {/* Trend chart */}
          {trendData.length > 0 && (
            <div className="rounded-xl border border-[#222] bg-[#111] p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-[#4f8ef7]" />
                <span className="text-sm font-medium text-white">Monthly trend</span>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={trendData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                  <XAxis dataKey="month" tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', fontSize: 12 }}
                    labelStyle={{ color: '#aaa' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#777' }} />
                  <Line type="monotone" dataKey="aiHeavyPct" name="AI-heavy %" stroke="#4f8ef7" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="attestedPct" name="Attested %" stroke="#22c55e" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-2 flex-wrap items-center">
            <Filter className="w-4 h-4 text-[#666] flex-shrink-0" />
            {[
              { key: 'aiHeavy', label: 'AI-heavy', active: aiHeavy },
              { key: 'noAttestation', label: 'Needs attestation', active: noAttestation },
              { key: 'exceptions', label: 'No review', active: exceptionsOnly },
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

          {/* Receipts table */}
          {listQ.isLoading ? (
            <div className="flex justify-center p-8"><Spinner /></div>
          ) : listItems.length === 0 ? (
            <div className="text-center py-16 text-[#666]">
              <FileText className="mx-auto mb-4 w-10 h-10 opacity-30" />
              <p>{listQ.data ? 'No PRs match the current filters.' : 'No merged PRs found yet.'}</p>
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
                  {listItems.map((item) => (
                    <tr
                      key={item.prNumber}
                      className={cn(
                        'hover:bg-[#141414] cursor-pointer transition-colors',
                        item.noReview && 'bg-red-950/5',
                      )}
                      onClick={() => navigate(`/receipts/${item.prNumber}${repoId ? `?repo=${repoId}` : ''}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-white flex items-center gap-1.5">
                          #{item.prNumber}
                          {item.noReview && <AlertTriangle className="h-3 w-3 text-red-400" />}
                        </div>
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
        </>
      )}
    </div>
  )
}

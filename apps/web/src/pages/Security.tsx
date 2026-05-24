import { useQuery } from '@tanstack/react-query'
import {
  ShieldCheck, Lock, Eye, EyeOff, CheckCircle, AlertCircle, Database, Cpu, Trophy, Link2
} from 'lucide-react'
import { api, type SecurityOverview } from '../lib/api.js'
import { cn } from '../lib/utils.js'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

const MILESTONE_LABELS: Record<string, string> = {
  first_ai_pr: 'First AI-assisted PR merged',
  adoption_50pct: 'AI adoption reached 50%',
  adoption_80pct: 'AI adoption reached 80%',
  roi_positive: 'Net ROI turned positive',
  waste_eliminated: 'All seats active — zero waste',
}

const MILESTONE_ICONS: Record<string, React.ElementType> = {
  first_ai_pr: Cpu,
  adoption_50pct: CheckCircle,
  adoption_80pct: CheckCircle,
  roi_positive: Trophy,
  waste_eliminated: ShieldCheck,
}

function SectionCard({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-[#222] bg-[#111] p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-[#222]">
          <Icon className="h-4 w-4 text-[#888]" />
        </div>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function TrustBadge({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/20 px-2.5 py-1 text-xs text-green-400">
      <CheckCircle className="h-3 w-3" />
      {label}
    </div>
  )
}

export function SecurityPage() {
  const { data, isLoading, isError } = useQuery<SecurityOverview>({
    queryKey: ['security', 'overview'],
    queryFn: api.security.overview,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#333] border-t-white" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-[#222] bg-[#111] p-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-[#444] mb-3" />
        <p className="text-[#666] text-sm">Could not load security overview.</p>
      </div>
    )
  }

  const roleLabel = data.role === 'owner' ? 'Owner' : data.role === 'admin' ? 'Admin' : 'Member'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Security &amp; Trust</h1>
        <p className="mt-1 text-sm text-[#555]">
          What Grassion can access, what it never reads, and your team's security posture.
        </p>
      </div>

      {/* Trust badges */}
      <div className="flex flex-wrap gap-2">
        <TrustBadge label="Read-only GitHub access" />
        <TrustBadge label="No source code stored" />
        <TrustBadge label="TLS in transit" />
        <TrustBadge label="Data scoped to your team" />
        <TrustBadge label="Sessions expire in 30 days" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Your Session */}
        <SectionCard title="Your Session" icon={Lock}>
          <dl className="space-y-3">
            <div className="flex justify-between items-center">
              <dt className="text-xs text-[#555]">Role</dt>
              <dd>
                <span className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider',
                  data.role === 'owner'
                    ? 'bg-purple-500/15 text-purple-400 border border-purple-500/20'
                    : data.role === 'admin'
                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                    : 'bg-white/8 text-[#888] border border-[#222]',
                )}>
                  {roleLabel}
                </span>
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-xs text-[#555]">Active sessions (team)</dt>
              <dd className="text-sm font-semibold text-white">{data.activeSessionCount}</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-xs text-[#555]">Session TTL</dt>
              <dd className="text-sm text-[#aaa]">30 days</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-xs text-[#555]">Authentication</dt>
              <dd className="text-sm text-[#aaa]">GitHub OAuth only</dd>
            </div>
          </dl>
          <div className="mt-4 border-t border-[#1a1a1a] pt-3">
            <p className="text-[10px] text-[#444] leading-relaxed">
              To revoke all sessions, uninstall and reinstall the GitHub App. Individual sessions expire automatically after 30 days.
            </p>
          </div>
        </SectionCard>

        {/* GitHub Permissions */}
        <SectionCard title="GitHub Permissions" icon={ShieldCheck}>
          <div className="space-y-3">
            {data.githubPermissions.map((p) => (
              <div key={p.scope} className="rounded-lg bg-[#0d0d0d] border border-[#1a1a1a] px-3 py-2.5">
                <div className="font-mono text-xs text-[#60a5fa] mb-0.5">{p.scope}</div>
                <div className="text-xs text-[#666] leading-relaxed">{p.description}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-500/5 border border-blue-500/15 px-3 py-2.5">
            <CheckCircle className="h-3.5 w-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[#888] leading-relaxed">
              These scopes are enforced by GitHub. Grassion is technically incapable of writing, merging, or modifying your repositories.
            </p>
          </div>
        </SectionCard>

        {/* Data Access */}
        <SectionCard title="Data Access" icon={Eye}>
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Eye className="h-3.5 w-3.5 text-green-400" />
                <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">What we read</span>
              </div>
              <ul className="space-y-1.5">
                {data.dataAccess.reads.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-[#888]">
                    <CheckCircle className="h-3 w-3 text-green-500/60 flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-[#1a1a1a] pt-4">
              <div className="flex items-center gap-2 mb-2">
                <EyeOff className="h-3.5 w-3.5 text-red-400" />
                <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">We never read</span>
              </div>
              <ul className="space-y-1.5">
                {data.dataAccess.neverReads.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-[#888]">
                    <EyeOff className="h-3 w-3 text-red-500/60 flex-shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </SectionCard>

        {/* Connected Repos */}
        <SectionCard title="Connected Repos" icon={Database}>
          {data.connectedRepos.length === 0 ? (
            <p className="text-sm text-[#555]">No repos connected yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.connectedRepos.map((r) => (
                <li key={r.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Link2 className="h-3.5 w-3.5 text-[#444]" />
                    <span className="text-sm font-mono text-[#aaa]">{r.name}</span>
                  </div>
                  <span className="text-xs text-[#555]">connected {timeAgo(r.connectedAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 border-t border-[#1a1a1a] pt-3">
            <p className="text-[10px] text-[#444] leading-relaxed">
              Grassion only ingests data from explicitly connected repos. Remove a repo in Settings to stop data collection immediately.
            </p>
          </div>
        </SectionCard>
      </div>

      {/* Milestones / Activity */}
      {data.milestones.length > 0 && (
        <div className="rounded-xl border border-[#222] bg-[#111] p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-[#222]">
              <Trophy className="h-4 w-4 text-yellow-400" />
            </div>
            <h2 className="text-sm font-semibold text-white">Team Milestones</h2>
          </div>
          <ul className="space-y-2">
            {data.milestones.map((m) => {
              const Icon = MILESTONE_ICONS[m.type] ?? CheckCircle
              return (
                <li key={m.type} className="flex items-center justify-between py-2 border-b border-[#1a1a1a] last:border-0">
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 text-yellow-400" />
                    <span className="text-sm text-[#aaa]">{MILESTONE_LABELS[m.type] ?? m.type}</span>
                  </div>
                  <span className="text-xs text-[#555]">{timeAgo(m.achievedAt)}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Contact */}
      <div className="rounded-xl border border-[#222] bg-[#111] p-5 flex items-start gap-4">
        <ShieldCheck className="h-5 w-5 text-[#555] flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-white mb-0.5">Security contact</p>
          <p className="text-sm text-[#666]">
            Report vulnerabilities or data concerns to{' '}
            <a href="mailto:info@grassion.com" className="text-blue-400 hover:underline">
              info@grassion.com
            </a>
            . We respond within 24 hours.
          </p>
        </div>
      </div>
    </div>
  )
}

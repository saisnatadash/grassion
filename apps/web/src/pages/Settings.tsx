import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Github, CheckCircle2, XCircle, ExternalLink, LogOut, Lock, Tag, MessageSquare, Hash, RefreshCw, Trash2, Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { usePlan } from '../lib/plan.js'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  SectionHeading,
  Spinner,
  Toggle,
} from '../components/ui.js'
import { cn } from '../lib/utils.js'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const AI_TOOLS = [
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    label_signal: 'copilot',
    trailer_signal: 'Co-authored-by: GitHub Copilot',
    body_signal: 'generated with copilot',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    label_signal: 'cursor',
    trailer_signal: 'Co-authored-by: cursor-ai',
    body_signal: 'generated with cursor',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    label_signal: 'claude-code',
    trailer_signal: 'Co-Authored-By: Claude',
    body_signal: 'generated with claude',
  },
  {
    id: 'codeium',
    label: 'Codeium',
    label_signal: 'codeium',
    trailer_signal: 'Co-authored-by: Codeium',
    body_signal: 'generated with codeium',
  },
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-sm text-[#888888]">Manage your team configuration and integrations.</p>
      </div>
      <GitHubSection />
      <TeamSettings />
      <SlackSection />
      <ReposSection />
      <MembersSection />
      <DangerZone />
    </div>
  )
}

/* ── GITHUB CONNECTION ── */
function GitHubSection() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub connection</CardTitle>
      </CardHeader>
      <CardContent>
        {me.isLoading ? (
          <Spinner />
        ) : me.data ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
            <div className="flex items-center gap-3">
              {me.data.user.avatarUrl ? (
                <img
                  src={me.data.user.avatarUrl}
                  alt={me.data.user.githubLogin}
                  className="h-10 w-10 rounded-full border border-[#333]"
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-[#222] border border-[#333] flex items-center justify-center text-sm font-semibold text-white">
                  {me.data.user.githubLogin[0]?.toUpperCase()}
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <Github className="h-4 w-4 text-[#888888]" />
                  <span className="text-sm font-medium text-white">@{me.data.user.githubLogin}</span>
                  <CheckCircle2 className="h-4 w-4 text-white" />
                </div>
                <div className="text-xs text-[#888888] mt-0.5">
                  {me.data.team.name} · {me.data.user.email ?? 'Connected'}
                </div>
              </div>
            </div>
            <a
              href="https://github.com/settings/installations"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-[#888888] hover:text-white transition-colors"
            >
              Manage GitHub App
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-[#888888]">
            <XCircle className="h-4 w-4 text-red-500" />
            Not connected
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── TEAM SETTINGS ── */
function TeamSettings() {
  const qc = useQueryClient()
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.get })
  const update = useMutation({
    mutationFn: api.team.update,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })

  const [form, setForm] = useState({
    monthlyAiSpendUsd: 0,
    avgDevHourlyRateUsd: 75,
    timezone: 'UTC',
    emailDigestEnabled: true,
    emailDigestDay: 1,
    emailDigestHour: 9,
  })

  useEffect(() => {
    if (team.data) {
      setForm({
        monthlyAiSpendUsd: team.data.monthlyAiSpendUsd,
        avgDevHourlyRateUsd: team.data.avgDevHourlyRateUsd,
        timezone: team.data.timezone,
        emailDigestEnabled: team.data.emailDigestEnabled,
        emailDigestDay: (team.data as { emailDigestDay?: number }).emailDigestDay ?? 1,
        emailDigestHour: (team.data as { emailDigestHour?: number }).emailDigestHour ?? 9,
      })
    }
  }, [team.data])

  if (team.isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Spinner />
        </CardContent>
      </Card>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        update.mutate(form as never)
      }}
      className="space-y-4"
    >
      {/* ROI calibration */}
      <Card>
        <CardHeader>
          <CardTitle>ROI calibration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[#888888] mb-1.5">Monthly AI spend (USD)</label>
              <Input
                type="number"
                min={0}
                step="1"
                value={form.monthlyAiSpendUsd}
                onChange={(e) => setForm({ ...form, monthlyAiSpendUsd: Number(e.target.value) })}
              />
              <p className="mt-1 text-xs text-[#555555]">Your total monthly AI tools bill (Copilot, Cursor, etc.)</p>
            </div>
            <div>
              <label className="block text-xs text-[#888888] mb-1.5">Avg dev hourly rate (USD)</label>
              <Input
                type="number"
                min={0}
                step="1"
                value={form.avgDevHourlyRateUsd}
                onChange={(e) => setForm({ ...form, avgDevHourlyRateUsd: Number(e.target.value) })}
              />
              <p className="mt-1 text-xs text-[#555555]">Used to estimate time-saved value in ROI calculations</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI tools */}
      <Card>
        <CardHeader>
          <CardTitle>How AI is detected</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-[#888888] mb-4">
            Grassion checks three signals in priority order on every merged PR. The first match wins.
          </p>
          <div className="flex items-start gap-6 mb-5 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-[#888888]">
              <Tag className="h-3.5 w-3.5 text-white flex-shrink-0" />
              <span><span className="text-white font-medium">1. PR Label</span> — highest priority</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#888888]">
              <MessageSquare className="h-3.5 w-3.5 text-white flex-shrink-0" />
              <span><span className="text-white font-medium">2. Git Trailer</span> — in commit message</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#888888]">
              <Hash className="h-3.5 w-3.5 text-white flex-shrink-0" />
              <span><span className="text-white font-medium">3. Body Regex</span> — fallback pattern match</span>
            </div>
          </div>
          <div className="divide-y divide-[#1a1a1a]">
            {AI_TOOLS.map((tool) => (
              <div key={tool.id} className="py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-white">{tool.label}</div>
                  <Badge tone="gray">Auto-detected</Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="rounded-md bg-[#0a0a0a] border border-[#222] px-3 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Tag className="h-3 w-3 text-[#555555]" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#555555]">Label</span>
                    </div>
                    <code className="text-xs text-[#cccccc] font-mono">{tool.label_signal}</code>
                  </div>
                  <div className="rounded-md bg-[#0a0a0a] border border-[#222] px-3 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <MessageSquare className="h-3 w-3 text-[#555555]" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#555555]">Trailer</span>
                    </div>
                    <code className="text-xs text-[#cccccc] font-mono break-all">{tool.trailer_signal}</code>
                  </div>
                  <div className="rounded-md bg-[#0a0a0a] border border-[#222] px-3 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Hash className="h-3 w-3 text-[#555555]" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#555555]">Body</span>
                    </div>
                    <code className="text-xs text-[#cccccc] font-mono">{tool.body_signal}</code>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-[#555555]">
            To ensure accurate detection, add a label or git trailer to your AI-assisted PRs. No configuration required — detection is automatic once the signal is present.
          </p>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <Toggle
            checked={form.emailDigestEnabled}
            onChange={(v) => setForm({ ...form, emailDigestEnabled: v })}
            label="Weekly email digest"
            description="Receive a weekly ROI summary every Monday morning"
          />
          {form.emailDigestEnabled && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 pl-0 pt-2 border-t border-[#1a1a1a]">
              <div>
                <label className="block text-xs text-[#888888] mb-1.5">Digest day</label>
                <select
                  value={form.emailDigestDay}
                  onChange={(e) => setForm({ ...form, emailDigestDay: Number(e.target.value) })}
                  className="block w-full rounded-lg border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/10"
                >
                  {DAYS.map((d, i) => (
                    <option key={d} value={i} className="bg-[#111]">{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#888888] mb-1.5">Digest hour (UTC)</label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={form.emailDigestHour}
                  onChange={(e) => setForm({ ...form, emailDigestHour: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timezone */}
      <Card>
        <CardHeader>
          <CardTitle>Timezone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <label className="block text-xs text-[#888888] mb-1.5">Team timezone</label>
            <Input
              type="text"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              placeholder="e.g. Asia/Kolkata"
            />
            <p className="mt-1 text-xs text-[#555555]">IANA timezone identifier for digest scheduling</p>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
        {update.isSuccess && <span className="text-sm text-white">Changes saved.</span>}
        {update.isError && <span className="text-sm text-red-500">Save failed. Try again.</span>}
      </div>
    </form>
  )
}

/* ── SLACK SECTION ── */
function SlackSection() {
  const qc = useQueryClient()
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.get })
  const [webhookUrl, setWebhookUrl] = useState('')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (team.data) {
      setWebhookUrl((team.data as { slackWebhookUrl?: string | null }).slackWebhookUrl ?? '')
    }
  }, [team.data])

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  const save = useMutation({
    mutationFn: () =>
      api.team.update({ slackWebhookUrl: webhookUrl.trim() || null } as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] })
      showToast('success', '✅ Webhook URL saved!')
    },
    onError: () => showToast('error', '❌ Save failed. Try again.'),
  })

  const test = useMutation({
    mutationFn: api.slack.test,
    onSuccess: () => showToast('success', '✅ Test message sent to Slack!'),
    onError: () => showToast('error', '❌ Failed — check your webhook URL'),
  })

  const isConfigured = !!((team.data as { slackWebhookUrl?: string | null } | undefined)?.slackWebhookUrl)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-[#888]" />
          <CardTitle>Slack notifications</CardTitle>
          <span
            title={isConfigured ? 'Slack connected' : 'Not configured'}
            className={cn(
              'h-2 w-2 rounded-full flex-shrink-0',
              isConfigured ? 'bg-green-500 animate-pulse' : 'bg-[#444]',
            )}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Input */}
        <div>
          <label className="block text-xs text-[#888888] mb-1.5">Webhook URL</label>
          <Input
            type="text"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
          />
          <p className="mt-1.5 text-xs text-[#555555]">
            Get your webhook URL from{' '}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noreferrer"
              className="text-[#888] underline underline-offset-2 hover:text-white transition-colors"
            >
              api.slack.com/apps
            </a>
            {' '}→ Incoming Webhooks
          </p>
        </div>

        {/* Preview */}
        <div className="rounded-lg border border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3">
          <p className="text-xs text-[#555555] font-mono leading-relaxed">
            📊 Weekly digest · Every Monday 9am IST<br />
            Includes: ROI verdict, savings, health score, top performer<br />
            ⚠️ Instant alert when a PR is reverted<br />
            🔴 Alert when health score drops below 75<br />
            💸 Alert when a seat goes idle for 7+ days
          </p>
        </div>

        {/* Toast */}
        {toast && (
          <p className={cn('text-sm font-medium', toast.type === 'success' ? 'text-green-400' : 'text-red-400')}>
            {toast.msg}
          </p>
        )}

        {/* Buttons */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => test.mutate()}
            disabled={test.isPending || !isConfigured}
            title={!isConfigured ? 'Save a webhook URL first' : undefined}
          >
            {test.isPending ? 'Sending…' : 'Send test message'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

const REPO_LIMITS: Record<string, number> = {
  trial: 1,
  free: 1,
  starter: 3,
  growth: 10,
  pro: 10,
  team: 10,
  business: 9999,
  admin: 9999,
}

/* ── REPOS SECTION ── */
function ReposSection() {
  const qc = useQueryClient()
  const { plan } = usePlan()
  const reposQuery = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })

  const repoLimit = REPO_LIMITS[plan ?? 'trial'] ?? 1
  const repoCount = reposQuery.data?.length ?? 0
  const atLimit = plan !== 'admin' && repoCount >= repoLimit

  const sync = useMutation({
    mutationFn: (id: string) => api.repos.sync(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repos'] }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.repos.disconnect(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repos'] }),
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Connected repositories</CardTitle>
            {plan !== 'admin' && repoLimit < 9999 && (
              <p className="text-xs text-[#555555] mt-1">{repoCount}/{repoLimit} repos on {plan ?? 'trial'} plan</p>
            )}
          </div>
          <a
            href="https://github.com/apps/grassion"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-[#888888] hover:text-white transition-colors"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub App
            <ExternalLink className="h-3 w-3" />
          </a>
        </CardHeader>
        <CardContent>
          {reposQuery.isLoading ? (
            <Spinner />
          ) : reposQuery.data && reposQuery.data.length === 0 ? (
            <div className="py-4 text-sm text-[#555555]">
              No repositories connected yet.
            </div>
          ) : (
            <ul className="divide-y divide-[#1a1a1a]">
              {reposQuery.data?.map((r) => (
                <li key={r.id} className="py-3.5 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Github className="h-3.5 w-3.5 text-[#555555] flex-shrink-0" />
                      <span className="text-sm font-medium text-white truncate">
                        {r.owner}/{r.name}
                      </span>
                      <Badge tone={r.isActive ? 'green' : 'gray'} className="flex-shrink-0">
                        {r.isActive ? 'Active' : 'Paused'}
                      </Badge>
                    </div>
                    <div className="text-xs text-[#555555] mt-0.5 pl-5">
                      {r.prCount} PRs synced · connected {timeAgo(r.connectedAt)}
                      {r.lastSyncedAt
                        ? ` · last synced ${timeAgo(r.lastSyncedAt)}`
                        : ' · never synced'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => sync.mutate(r.id)}
                      disabled={sync.isPending}
                      title="Re-sync historical PRs"
                      className="flex items-center gap-1.5"
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} />
                      Sync Now
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Remove ${r.owner}/${r.name}? This will delete all synced PR data.`)) {
                          remove.mutate(r.id)
                        }
                      }}
                      disabled={remove.isPending}
                      className="flex items-center gap-1.5 text-red-500 hover:text-red-400"
                      title="Remove repository"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Manual connect form */}
      <ConnectRepoForm
        onConnected={() => qc.invalidateQueries({ queryKey: ['repos'] })}
        disabled={atLimit}
        limitReached={atLimit}
        plan={plan ?? 'trial'}
      />
    </div>
  )
}

/* ── CONNECT REPO FORM ── */
function ConnectRepoForm({
  onConnected,
  disabled = false,
  limitReached = false,
  plan = 'trial',
}: {
  onConnected: () => void
  disabled?: boolean
  limitReached?: boolean
  plan?: string
}) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const connect = useMutation({
    mutationFn: (repoUrl: string) => api.repos.connect(repoUrl),
    onSuccess: (data) => {
      setUrl('')
      setStatus({
        type: 'success',
        msg: data.alreadyConnected
          ? `${data.repoName} is already connected.`
          : `✅ Synced ${data.prsSynced} PRs from ${data.repoName}`,
      })
      onConnected()
    },
    onError: (err: { message?: string }) => {
      setStatus({ type: 'error', msg: err?.message ?? 'Failed to connect. Check the URL and try again.' })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a repository</CardTitle>
      </CardHeader>
      <CardContent>
        {limitReached ? (
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 text-sm text-yellow-400">
            You've reached the {plan} plan limit.{' '}
            <Link to="/billing" className="underline hover:text-yellow-300">Upgrade</Link>{' '}
            to connect more repositories.
          </div>
        ) : (
          <>
            <p className="text-xs text-[#555555] mb-4">
              Paste a public GitHub repo URL to start tracking it — no GitHub App installation needed.
            </p>
            <div className="flex gap-2">
              <Input
                type="url"
                placeholder="https://github.com/owner/repo"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setStatus(null) }}
                className="flex-1"
                disabled={disabled}
              />
              <Button
                onClick={() => connect.mutate(url)}
                disabled={connect.isPending || !url.trim() || disabled}
              >
                {connect.isPending ? <Spinner className="h-4 w-4" /> : 'Connect & Sync'}
              </Button>
            </div>
            {status && (
              <p className={cn('mt-2 text-xs', status.type === 'success' ? 'text-white' : 'text-red-400')}>
                {status.msg}
              </p>
            )}
            <p className="mt-3 text-xs text-[#444444]">
              For private repos, install the{' '}
              <a href="https://github.com/apps/grassion" target="_blank" rel="noreferrer" className="text-[#888888] hover:text-white underline transition-colors">
                Grassion GitHub App
              </a>{' '}
              instead.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ── MEMBERS SECTION ── */
function MembersSection() {
  const qc = useQueryClient()
  const members = useQuery({ queryKey: ['members'], queryFn: api.team.members })
  const remove = useMutation({
    mutationFn: api.team.removeMember,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team members</CardTitle>
      </CardHeader>
      <CardContent>
        {members.isLoading ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-[#1a1a1a]">
            {members.data?.map((m) => (
              <li key={m.id} className="py-3.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {m.avatarUrl ? (
                    <img src={m.avatarUrl} alt="" className="h-8 w-8 rounded-full border border-[#333] flex-shrink-0" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-[#222] border border-[#333] flex-shrink-0 flex items-center justify-center text-xs font-semibold text-white">
                      {m.githubLogin[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{m.githubLogin}</div>
                    <div className="text-xs text-[#555555] mt-0.5 truncate">{m.email ?? 'no email'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Badge tone={m.role === 'owner' ? 'blue' : 'gray'}>{m.role}</Badge>
                  {m.role !== 'owner' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove.mutate(m.id)}
                      disabled={remove.isPending}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/* ── DANGER ZONE ── */
function DangerZone() {
  const qc = useQueryClient()

  async function signOut() {
    await api.logout()
    qc.clear()
    localStorage.removeItem('grassion_token')
    localStorage.removeItem('grassion_onboarded')
    window.location.href = 'https://grassion.com'
  }

  return (
    <div>
      <SectionHeading>Danger zone</SectionHeading>
      <Card>
        <CardContent className="py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-white">Sign out</div>
              <div className="text-xs text-[#888888] mt-0.5">Sign out of your Grassion account on this device.</div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={signOut}
              className="flex items-center gap-2"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

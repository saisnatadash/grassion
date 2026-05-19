import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Github, CheckCircle2, XCircle, ExternalLink, LogOut, Lock, Tag, MessageSquare, Hash } from 'lucide-react'
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
  const { isPaid } = usePlan()
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
          {/* Slack — Pro only */}
          <div className="mt-0 pt-0 border-t border-[#1a1a1a]">
            <SlackNotificationsRow isPaid={isPaid} />
          </div>
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

/* ── SLACK NOTIFICATIONS ROW ── */
function SlackNotificationsRow({ isPaid }: { isPaid: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <div className={cn('text-sm font-medium flex items-center gap-2', isPaid ? 'text-white' : 'text-[#555555]')}>
          Slack notifications
          {!isPaid && <Lock className="h-3.5 w-3.5 text-[#555555]" />}
        </div>
        <div className="text-xs text-[#555555] mt-0.5">
          {isPaid
            ? 'Send weekly ROI digest to a Slack channel'
            : 'Available on Pro — get alerts in Slack when your AI ROI changes'}
        </div>
      </div>
      {isPaid ? (
        <button
          type="button"
          disabled
          className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent bg-[#333333]"
        >
          <span className="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm translate-x-0" />
        </button>
      ) : (
        <Link
          to="/billing"
          className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-2.5 py-1 text-xs font-medium text-yellow-400 hover:bg-yellow-500/10 transition-colors flex-shrink-0"
        >
          <Lock className="h-3 w-3" />
          Upgrade to Pro
        </Link>
      )}
    </div>
  )
}

/* ── REPOS SECTION ── */
function ReposSection() {
  const qc = useQueryClient()
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.repos.toggle(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repos'] }),
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Connected repositories</CardTitle>
        <a
          href="https://github.com/apps/grassion"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-[#888888] hover:text-white transition-colors"
        >
          <Github className="h-3.5 w-3.5" />
          Connect repo
          <ExternalLink className="h-3 w-3" />
        </a>
      </CardHeader>
      <CardContent>
        {repos.isLoading ? (
          <Spinner />
        ) : repos.data && repos.data.length === 0 ? (
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
            <p className="text-sm text-yellow-400">
              No repos connected. Install the Grassion GitHub App to add repositories.
            </p>
            <a
              href="https://github.com/apps/grassion"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-yellow-400/70 hover:text-yellow-400 transition-colors"
            >
              Install GitHub App <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <ul className="divide-y divide-[#1a1a1a]">
            {repos.data?.map((r) => (
              <li key={r.id} className="py-3.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Github className="h-3.5 w-3.5 text-[#555555] flex-shrink-0" />
                    <span className="text-sm font-medium text-white truncate">
                      {r.owner}/{r.name}
                    </span>
                  </div>
                  <div className="text-xs text-[#555555] mt-0.5 pl-5">
                    {r.defaultBranch} · connected {new Date(r.connectedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Badge tone={r.isActive ? 'green' : 'gray'}>{r.isActive ? 'Active' : 'Paused'}</Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toggle.mutate({ id: r.id, isActive: !r.isActive })}
                    disabled={toggle.isPending}
                  >
                    {r.isActive ? 'Pause' : 'Activate'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
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
  const navigate = useNavigate()
  const qc = useQueryClient()

  async function signOut() {
    await api.logout()
    qc.clear()
    navigate('/login', { replace: true })
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

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'

export function SettingsPage() {
  return (
    <div className="space-y-8">
      <TeamSettings />
      <ReposSection />
      <MembersSection />
    </div>
  )
}

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {team.isLoading ? (
          <Spinner />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              update.mutate(form as never)
            }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <Field label="Monthly AI spend (USD)">
              <input
                type="number"
                min={0}
                step="1"
                value={form.monthlyAiSpendUsd}
                onChange={(e) => setForm({ ...form, monthlyAiSpendUsd: Number(e.target.value) })}
                className={inputCls}
              />
            </Field>
            <Field label="Avg dev hourly rate (USD)">
              <input
                type="number"
                min={0}
                step="1"
                value={form.avgDevHourlyRateUsd}
                onChange={(e) => setForm({ ...form, avgDevHourlyRateUsd: Number(e.target.value) })}
                className={inputCls}
              />
            </Field>
            <Field label="Timezone">
              <input
                type="text"
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Weekly email digest">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.emailDigestEnabled}
                  onChange={(e) => setForm({ ...form, emailDigestEnabled: e.target.checked })}
                />
                <span className="text-sm">Send weekly summary email</span>
              </label>
            </Field>
            <Field label="Digest day (UTC)">
              <select
                value={form.emailDigestDay}
                onChange={(e) => setForm({ ...form, emailDigestDay: Number(e.target.value) })}
                className={inputCls}
              >
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Digest hour (UTC)">
              <input
                type="number"
                min={0}
                max={23}
                value={form.emailDigestHour}
                onChange={(e) => setForm({ ...form, emailDigestHour: Number(e.target.value) })}
                className={inputCls}
              />
            </Field>
            <div className="md:col-span-2 flex items-center gap-3">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </Button>
              {update.isSuccess && <span className="text-sm text-green-700">Saved.</span>}
              {update.isError && <span className="text-sm text-red-700">Save failed.</span>}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function ReposSection() {
  const qc = useQueryClient()
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.repos.toggle(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repos'] }),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected repositories</CardTitle>
      </CardHeader>
      <CardContent>
        {repos.isLoading ? (
          <Spinner />
        ) : repos.data && repos.data.length === 0 ? (
          <Alert tone="yellow">
            No repos connected. Install the Grassion GitHub App to add some.
          </Alert>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {repos.data?.map((r) => (
              <li key={r.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {r.owner}/{r.name}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {r.defaultBranch} • connected {new Date(r.connectedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
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
          <ul className="divide-y divide-neutral-100">
            {members.data?.map((m) => (
              <li key={m.id} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {m.avatarUrl && (
                    <img src={m.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
                  )}
                  <div>
                    <div className="font-medium">{m.githubLogin}</div>
                    <div className="text-xs text-neutral-500">{m.email ?? 'no email'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
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

const inputCls =
  'block w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, GitPullRequest, Users, DollarSign, Zap, ArrowRight } from 'lucide-react'
import { api } from '../lib/api.js'
import { useInstallPopup } from '../lib/install-popup.js'
import { Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'
import { cn } from '../lib/utils.js'

const STEPS = [
  { n: 1, label: 'Install the GitHub App', icon: GitPullRequest },
  { n: 2, label: 'Tell us about your team', icon: Users },
  { n: 3, label: 'Enable repositories', icon: Zap },
  { n: 4, label: 'Set AI spend for ROI tracking', icon: DollarSign },
]

export function OnboardingPage() {
  const navigate = useNavigate()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })
  const qc = useQueryClient()
  const { open: openInstall, syncing: installSyncing } = useInstallPopup()
  const update = useMutation({
    mutationFn: api.team.update,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })

  const [step, setStep] = useState(1)
  const [spend, setSpend] = useState(0)
  const [rate, setRate] = useState(75)
  const [done, setDone] = useState(false)

  if (me.isLoading) return <Spinner />

  const installed = !!me.data?.team.githubInstallationId
  const repoCount = repos.data?.length ?? 0

  if (done) {
    return (
      <div className="mx-auto max-w-xl space-y-6 py-8">
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 border border-green-500/30">
            <CheckCircle className="h-7 w-7 text-green-500" />
          </div>
          <h1 className="text-2xl font-semibold text-white">You are all set</h1>
          <p className="text-sm text-[#888]">
            Grassion is now backfilling 12 months of your PR history. Your first AI Code Risk report will appear within a few minutes.
          </p>
        </div>

        <Card>
          <CardContent className="py-5 space-y-3">
            <p className="text-sm font-medium text-white">What happens next</p>
            {[
              'Grassion reads your merged PRs and detects which ones used AI tools',
              'Code areas with no human reviewer are flagged as dark code',
              'Every PR gets a Merge Receipt with the reviewer and AI percentage',
              'You get a weekly email if risky PRs slip through without review',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2 text-sm text-[#888]">
                <span className="text-green-500 flex-shrink-0">+</span>
                {item}
              </div>
            ))}
          </CardContent>
        </Card>

        <Button
          className="w-full flex items-center justify-center gap-2"
          onClick={() => navigate('/')}
        >
          Go to Overview
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Welcome to Grassion</h1>
        <p className="text-sm text-[#888] mt-1">
          4 quick steps to your first AI accountability report. Takes about 5 minutes.
        </p>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map(({ n, label }) => (
          <div key={n} className="flex items-center gap-2 flex-1">
            <div className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold flex-shrink-0',
              step > n ? 'bg-green-500 text-white' : step === n ? 'bg-white text-black' : 'bg-[#1a1a1a] text-[#555]',
            )}>
              {step > n ? '✓' : n}
            </div>
            {n < STEPS.length && <div className={cn('h-px flex-1', step > n ? 'bg-green-500/50' : 'bg-[#222]')} />}
          </div>
        ))}
      </div>

      {/* Step 1 — Install */}
      <StepCard n={1} active={step === 1} done={step > 1} title="Install the GitHub App">
        <p className="text-sm text-[#888] mb-4">
          Grassion connects to your GitHub organisation to read PR history and post check runs. It only reads — it never writes code or force-pushes anything.
        </p>
        {installed ? (
          <div className="flex items-center gap-2 text-sm text-green-500">
            <CheckCircle className="h-4 w-4" />
            GitHub App installed
          </div>
        ) : (
          <Button onClick={openInstall} disabled={installSyncing}>
            {installSyncing ? 'Connecting…' : 'Install on GitHub'}
          </Button>
        )}
        {installSyncing && (
          <p className="mt-2 text-xs text-[#555]">Syncing your repositories — this takes a moment…</p>
        )}
        <div className="mt-4">
          <Button variant="secondary" size="sm" disabled={!installed && !installSyncing} onClick={() => setStep(2)}>
            Continue
          </Button>
        </div>
      </StepCard>

      {/* Step 2 — Team info */}
      <StepCard n={2} active={step === 2} done={step > 2} title="Tell us about your team">
        <p className="text-sm text-[#888] mb-4">
          How many developers use AI coding tools (Copilot, Cursor, etc.) on your team?
        </p>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {[
            { label: '1 to 10', value: 10 },
            { label: '11 to 30', value: 30 },
            { label: '31 to 75', value: 75 },
            { label: '75+', value: 100 },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={async () => {
                await update.mutateAsync({ teamSizeRange: String(opt.value) } as never).catch(() => null)
              }}
              className="rounded-lg border border-[#333] px-3 py-3 text-left text-sm text-white hover:border-[#555] hover:bg-white/5 transition-colors focus:outline-none"
            >
              {opt.label} devs
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setStep(3)}>
          Continue
        </Button>
      </StepCard>

      {/* Step 3 — Repos */}
      <StepCard n={3} active={step === 3} done={step > 3} title="Enable repositories">
        <p className="text-sm text-[#888] mb-3">
          We found <strong className="text-white">{repoCount}</strong> repo{repoCount === 1 ? '' : 's'} from your GitHub App install.
          Once you enable a repo, Grassion backfills the last 12 months of PR history automatically.
        </p>
        {repoCount === 0 ? (
          <p className="text-sm text-yellow-400">
            No repos found yet. Make sure the GitHub App has access to at least one repository.
          </p>
        ) : (
          <p className="text-xs text-[#555] mb-4">
            You can enable specific repos in <a href="/settings" className="text-blue-400 hover:underline">Settings</a>. You can always add or remove repos later.
          </p>
        )}
        <Button variant="secondary" size="sm" onClick={() => setStep(4)}>
          Continue
        </Button>
      </StepCard>

      {/* Step 4 — AI spend */}
      <StepCard n={4} active={step === 4} done={false} title="Set your AI tool spend">
        <p className="text-sm text-[#888] mb-4">
          Grassion uses this to calculate your weekly ROI verdict: hours saved minus rework cost. A rough estimate is fine.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <label className="block">
            <span className="text-xs text-[#555] uppercase tracking-wider">Monthly AI tool spend (USD)</span>
            <input
              type="number"
              min={0}
              value={spend}
              onChange={(e) => setSpend(Number(e.target.value))}
              className="mt-1 block w-full rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2 text-white focus:border-[#555] focus:outline-none"
              placeholder="e.g. 200"
            />
          </label>
          <label className="block">
            <span className="text-xs text-[#555] uppercase tracking-wider">Avg dev hourly rate (USD)</span>
            <input
              type="number"
              min={0}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className="mt-1 block w-full rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2 text-white focus:border-[#555] focus:outline-none"
              placeholder="e.g. 75"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={update.isPending}
            onClick={async () => {
              await update.mutateAsync({
                monthlyAiSpendUsd: spend,
                avgDevHourlyRateUsd: rate,
              } as never)
              setDone(true)
            }}
          >
            {update.isPending ? 'Saving…' : 'Finish setup'}
          </Button>
          <Button variant="ghost" onClick={() => setDone(true)}>
            Skip
          </Button>
        </div>
      </StepCard>
    </div>
  )
}

function StepCard({
  n, active, done, title, children,
}: {
  n: number
  active: boolean
  done: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn(!active && 'opacity-60')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold flex-shrink-0',
            done ? 'bg-green-500 text-white' : active ? 'bg-white text-black' : 'bg-[#222] text-[#555]',
          )}>
            {done ? '✓' : n}
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

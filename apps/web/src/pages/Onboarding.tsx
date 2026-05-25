import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api, installUrl } from '../lib/api.js'
import { Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'
import { cn } from '../lib/utils.js'

const TEAM_SIZE_OPTIONS = [
  { label: '1–10 devs', value: 10, plan: 'Starter', price: '$49/mo' },
  { label: '11–30 devs', value: 30, plan: 'Growth', price: '$149/mo' },
  { label: '31–75 devs', value: 75, plan: 'Business', price: '$399/mo' },
  { label: '75+ devs', value: 100, plan: 'Enterprise', price: 'Contact us' },
]

export function OnboardingPage() {
  const navigate = useNavigate()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list })
  const qc = useQueryClient()
  const update = useMutation({
    mutationFn: api.team.update,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })

  const [step, setStep] = useState(1)
  const [teamSize, setTeamSize] = useState<number | null>(null)
  const [spend, setSpend] = useState(0)
  const [rate, setRate] = useState(75)

  if (me.isLoading) return <Spinner />

  const installed = !!me.data?.team.githubInstallationId
  const suggestedPlan = TEAM_SIZE_OPTIONS.find((o) => o.value >= (teamSize ?? 0)) ?? TEAM_SIZE_OPTIONS[3]!

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Welcome to Grassion</h1>
      <p className="text-sm text-neutral-600">4 quick steps to your first weekly ROI report.</p>

      {/* Step 1: Install GitHub App */}
      <Step n={1} active={step === 1} done={step > 1} title="Install the GitHub App">
        {installed ? (
          <p className="text-sm text-green-700">✓ Installed.</p>
        ) : (
          <a href={installUrl()} target="_blank" rel="noreferrer">
            <Button>Install on GitHub</Button>
          </a>
        )}
        <div className="mt-3">
          <Button variant="secondary" size="sm" disabled={!installed} onClick={() => setStep(2)}>
            Next
          </Button>
        </div>
      </Step>

      {/* Step 2: Team size → plan recommendation */}
      <Step n={2} active={step === 2} done={step > 2} title="How many developers on your team?">
        <div className="grid grid-cols-2 gap-2">
          {TEAM_SIZE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTeamSize(opt.value)}
              className={cn(
                'rounded-lg border px-3 py-3 text-left transition-colors focus:outline-none',
                teamSize === opt.value
                  ? 'border-green-500/60 bg-green-500/5'
                  : 'border-neutral-200 hover:border-neutral-400',
              )}
            >
              <div className="text-sm font-medium">{opt.label}</div>
              <div className="text-xs text-neutral-500 mt-0.5">{opt.plan} · {opt.price}</div>
            </button>
          ))}
        </div>

        {teamSize !== null && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <div className="text-sm font-medium text-green-800">
              Recommended: {suggestedPlan.plan}
            </div>
            <div className="text-xs text-green-700 mt-0.5">
              {suggestedPlan.price}{' '}
              {suggestedPlan.plan !== 'Enterprise'
                ? `· includes up to ${suggestedPlan.value} seats`
                : '· unlimited seats, contact us'}
            </div>
          </div>
        )}

        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => setStep(3)} disabled={teamSize === null}>
            Next
          </Button>
        </div>
      </Step>

      {/* Step 3: Connect repos */}
      <Step n={3} active={step === 3} done={step > 3} title="Connect repositories">
        <p className="text-sm text-neutral-600">
          We detected <strong>{repos.data?.length ?? 0}</strong> connected repo{repos.data?.length === 1 ? '' : 's'}.
          We'll start analyzing your PRs automatically.
        </p>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => setStep(4)}>
            Next
          </Button>
        </div>
      </Step>

      {/* Step 4: AI spend calibration */}
      <Step n={4} active={step === 4} done={false} title="Set your AI spend for ROI tracking">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>
            Monthly AI tool spend ($)
            <input
              type="number"
              min={0}
              value={spend}
              onChange={(e) => setSpend(Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2"
            />
          </label>
          <label>
            Avg dev hourly rate ($)
            <input
              type="number"
              min={0}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2"
            />
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            disabled={update.isPending}
            onClick={async () => {
              await update.mutateAsync({
                monthlyAiSpendUsd: spend,
                avgDevHourlyRateUsd: rate,
              } as never)
              navigate('/dashboard')
            }}
          >
            {update.isPending ? 'Saving…' : 'Go to Dashboard'}
          </Button>
          <Button variant="ghost" onClick={() => navigate('/dashboard')}>
            Skip
          </Button>
        </div>
      </Step>
    </div>
  )
}

function Step({
  n,
  active,
  done,
  title,
  children,
}: {
  n: number
  active: boolean
  done: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <Card className={active ? '' : 'opacity-70'}>
      <CardHeader>
        <CardTitle>
          {done ? '✓' : n}. {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

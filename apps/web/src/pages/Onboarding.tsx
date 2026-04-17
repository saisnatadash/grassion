import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api, installUrl } from '../lib/api.js'
import { Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'

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
  const [spend, setSpend] = useState(0)
  const [rate, setRate] = useState(75)

  if (me.isLoading) return <Spinner />

  const installed = !!me.data?.team.githubInstallationId

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Welcome to Grassion</h1>
      <p className="text-sm text-neutral-600">3 quick steps to your first weekly report.</p>

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

      <Step n={2} active={step === 2} done={step > 2} title="Connect repositories">
        <p className="text-sm text-neutral-600">We detected {repos.data?.length ?? 0} connected repos.</p>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => setStep(3)}>
            Next
          </Button>
        </div>
      </Step>

      <Step n={3} active={step === 3} done={false} title="Tell us your AI spend">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>
            Monthly AI spend ($)
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
            {update.isPending ? 'Saving…' : 'Finish'}
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

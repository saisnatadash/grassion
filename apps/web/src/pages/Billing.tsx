import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api.js'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
} from '../components/ui.js'

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance
  }
}

interface RazorpayOptions {
  key: string
  subscription_id: string
  name: string
  description?: string
  image?: string
  prefill?: { name?: string; email?: string }
  theme?: { color?: string }
  notes?: Record<string, string>
  handler: (response: RazorpayCheckoutResponse) => void | Promise<void>
  modal?: { ondismiss?: () => void }
}

interface RazorpayCheckoutResponse {
  razorpay_payment_id: string
  razorpay_subscription_id: string
  razorpay_signature: string
}

interface RazorpayInstance {
  open(): void
  on(event: string, handler: (data: unknown) => void): void
}

export function BillingPage() {
  const [searchParams] = useSearchParams()
  const justSucceeded = searchParams.get('subscribed') === '1'
  const [error, setError] = useState<string | null>(null)
  const sub = useQuery({ queryKey: ['subscription'], queryFn: api.billing.subscription })
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const members = useQuery({ queryKey: ['members'], queryFn: api.team.members })
  const qc = useQueryClient()
  const memberCount = members.data?.length ?? 1
  const [seatCount, setSeatCount] = useState<number>(Math.max(1, memberCount))
  const [busy, setBusy] = useState(false)

  const isLive =
    sub.data?.status === 'active' ||
    sub.data?.status === 'authenticated' ||
    sub.data?.status === 'pending'

  async function startCheckout() {
    setError(null)
    if (!window.Razorpay) {
      setError('Razorpay checkout failed to load. Refresh and try again.')
      return
    }
    setBusy(true)
    try {
      const response = await api.billing.subscribe(seatCount)
      const options: RazorpayOptions = {
        key: response.razorpayKey,
        subscription_id: response.subscriptionId,
        name: 'Grassion',
        description: `Starter plan · ${seatCount} developer${seatCount === 1 ? '' : 's'}`,
        image: '/favicon.svg',
        prefill: {
          email: me.data?.user.email ?? undefined,
          name: me.data?.user.githubLogin,
        },
        theme: { color: '#0F172A' },
        modal: { ondismiss: () => setBusy(false) },
        handler: async (resp) => {
          try {
            await api.billing.verify(resp)
            await qc.invalidateQueries({ queryKey: ['subscription'] })
            window.location.assign('/dashboard?subscribed=1')
          } catch (err) {
            setError(
              err instanceof ApiError
                ? `Payment verification failed (${err.message}). Contact support@grassion.com.`
                : 'Payment verification failed. Contact support@grassion.com.',
            )
            setBusy(false)
          }
        },
      }
      const rzp = new window.Razorpay(options)
      rzp.open()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to start checkout')
      setBusy(false)
    }
  }

  async function cancelSubscription() {
    setError(null)
    if (!confirm('Cancel subscription at the end of the current period?')) return
    setBusy(true)
    try {
      await api.billing.cancel()
      await qc.invalidateQueries({ queryKey: ['subscription'] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to cancel')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {justSucceeded && (
        <Alert tone="green">
          Subscription started. You'll receive a Razorpay receipt by email.
        </Alert>
      )}
      {error && <Alert tone="red">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
        </CardHeader>
        <CardContent>
          {sub.isLoading ? (
            <Spinner />
          ) : sub.isError || !sub.data ? (
            <Alert tone="red">Could not load subscription.</Alert>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={isLive ? 'green' : sub.data.status === 'cancelled' ? 'red' : 'gray'}>
                  {sub.data.status}
                </Badge>
                <span className="font-medium capitalize">{sub.data.plan}</span>
                {sub.data.currentPeriodEnd && (
                  <span className="text-sm text-neutral-500">
                    Renews {new Date(sub.data.currentPeriodEnd).toLocaleDateString()}
                  </span>
                )}
                {sub.data.trialEndsAt && !isLive && (
                  <span className="text-sm text-neutral-500">
                    Trial ends {new Date(sub.data.trialEndsAt).toLocaleDateString()}
                  </span>
                )}
                {sub.data.seatCount > 0 && (
                  <span className="text-sm text-neutral-500">{sub.data.seatCount} seats</span>
                )}
              </div>

              {isLive ? (
                <Button variant="secondary" disabled={busy} onClick={cancelSubscription}>
                  Cancel at period end
                </Button>
              ) : (
                <div className="rounded-md border border-neutral-200 p-4">
                  <h3 className="font-semibold">Grassion Starter — ₹2,400 / $29 per dev / month</h3>
                  <p className="mt-1 text-sm text-neutral-600">
                    14-day trial included. Cancel anytime.
                  </p>
                  <div className="mt-3 flex items-end gap-3">
                    <label className="block">
                      <span className="text-xs text-neutral-500">Seats</span>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={seatCount}
                        onChange={(e) => setSeatCount(Math.max(1, Number(e.target.value)))}
                        className="mt-1 block w-24 rounded-md border border-neutral-200 px-3 py-2 text-sm"
                      />
                    </label>
                    <Button disabled={busy} onClick={startCheckout}>
                      {busy ? 'Loading…' : 'Start subscription'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

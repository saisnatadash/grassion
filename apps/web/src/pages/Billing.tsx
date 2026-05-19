import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Check, Zap, Shield, Star } from 'lucide-react'
import { api, ApiError } from '../lib/api.js'
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
  Spinner,
} from '../components/ui.js'
import { cn } from '../lib/utils.js'

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOrderOptions) => RazorpayInstance
  }
}

interface RazorpayOrderOptions {
  key: string
  order_id: string
  amount: number
  currency: string
  name: string
  description?: string
  image?: string
  prefill?: { name?: string; email?: string }
  theme?: { color?: string }
  handler: (response: RazorpayOrderResponse) => void | Promise<void>
  modal?: { ondismiss?: () => void }
}

interface RazorpayOrderResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

interface RazorpayInstance {
  open(): void
  on(event: string, handler: (data: unknown) => void): void
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) { resolve(); return }
    const existing = document.querySelector('script[src*="checkout.razorpay.com"]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Razorpay script failed')))
      return
    }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Razorpay checkout'))
    document.head.appendChild(script)
  })
}

const PRO_FEATURES = [
  'Unlimited repositories',
  'Full team analytics & seat waste',
  'Weekly email digest reports',
  'OpenAI PR summaries',
  'Priority support',
  'Export data to CSV',
]

const FREE_FEATURES = [
  'Up to 2 repositories',
  'Basic ROI verdict',
  'Problem PR detection',
  '30-day PR history',
]

export function BillingPage() {
  const [searchParams] = useSearchParams()
  const justSucceeded = searchParams.get('subscribed') === '1'
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(justSucceeded)
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

  // usePlan reads the plan from the JWT immediately (no loading flash) and stays
  // in sync with the /api/team response after any plan changes.
  const { plan, isPaid: isPro, isTrial } = usePlan()

  async function startCheckout() {
    setError(null)
    setBusy(true)
    try {
      await loadRazorpayScript()
    } catch {
      setError('Failed to load Razorpay. Check your network connection and try again.')
      setBusy(false)
      return
    }
    if (!window.Razorpay) {
      setError('Razorpay checkout unavailable. Refresh and try again.')
      setBusy(false)
      return
    }
    try {
      // Step 1: create order on server (₹2400 × seats)
      const order = await api.billing.checkout(seatCount)

      // Step 2: open Razorpay modal
      const options: RazorpayOrderOptions = {
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'Grassion',
        description: `Pro plan · ${seatCount} developer${seatCount === 1 ? '' : 's'}`,
        image: '/favicon.svg',
        prefill: {
          email: me.data?.user.email ?? undefined,
          name: me.data?.user.githubLogin,
        },
        theme: { color: '#22c55e' },
        modal: { ondismiss: () => setBusy(false) },
        handler: async (resp: RazorpayOrderResponse) => {
          try {
            // Step 3: verify on server, which upgrades the plan to 'starter'
            await api.billing.verify({
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_signature: resp.razorpay_signature,
              seatCount,
            })
            // Step 4: refresh plan and subscription data
            await Promise.all([
              qc.invalidateQueries({ queryKey: ['subscription'] }),
              qc.invalidateQueries({ queryKey: ['team'] }),
              qc.invalidateQueries({ queryKey: ['me'] }),
            ])
            setSuccess(true)
            setBusy(false)
          } catch (err) {
            setError(
              err instanceof ApiError
                ? `Payment verification failed (${err.message}). Contact info@grassion.com.`
                : 'Payment verification failed. Contact info@grassion.com.',
            )
            setBusy(false)
          }
        },
      }
      const rzp = new window.Razorpay(options)
      rzp.open()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start checkout.')
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
      setError(err instanceof ApiError ? err.message : 'Failed to cancel.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {success && (
        <Alert tone="green">
          Payment successful! You're now on Pro. Your plan has been upgraded.
        </Alert>
      )}
      {error && <Alert tone="red">{error}</Alert>}

      {/* ── CURRENT PLAN BANNER ── */}
      <CurrentPlanCard
        plan={plan ?? 'trial'}
        subData={sub.data}
        isLive={isLive}
        isTrial={isTrial}
        isPro={isPro}
        isLoading={sub.isLoading}
        busy={busy}
        onCancel={cancelSubscription}
      />

      {/* ── UPGRADE CARD (only when not pro) ── */}
      {!isPro && (
        <UpgradeCard
          seatCount={seatCount}
          setSeatCount={setSeatCount}
          memberCount={memberCount}
          busy={busy}
          onCheckout={startCheckout}
          isTrial={isTrial}
        />
      )}

      {/* ── PLAN COMPARISON ── */}
      <PlanComparison isPro={isPro} />
    </div>
  )
}

/* ── CURRENT PLAN BANNER ── */
function CurrentPlanCard({
  plan,
  subData,
  isLive,
  isTrial,
  isPro,
  isLoading,
  busy,
  onCancel,
}: {
  plan: string
  subData: Awaited<ReturnType<typeof api.billing.subscription>> | undefined
  isLive: boolean
  isTrial: boolean
  isPro: boolean
  isLoading: boolean
  busy: boolean
  onCancel: () => void
}) {
  const planConfig = {
    starter: { border: 'border-green-500/40', bg: 'bg-green-500/5', icon: <Star className="h-5 w-5 text-green-500" />, badgeTone: 'green' as const, label: 'Starter' },
    team:    { border: 'border-green-500/40', bg: 'bg-green-500/5', icon: <Star className="h-5 w-5 text-green-500" />, badgeTone: 'green' as const, label: 'Team' },
    business:{ border: 'border-green-500/40', bg: 'bg-green-500/5', icon: <Star className="h-5 w-5 text-green-500" />, badgeTone: 'green' as const, label: 'Business' },
    trial:   { border: 'border-yellow-500/40', bg: 'bg-yellow-500/5', icon: <Zap className="h-5 w-5 text-yellow-400" />, badgeTone: 'yellow' as const, label: '14-day Trial' },
    free:    { border: 'border-[#333]', bg: 'bg-white/2', icon: <Shield className="h-5 w-5 text-[#888888]" />, badgeTone: 'gray' as const, label: 'Free' },
  }
  const cfg = planConfig[plan as keyof typeof planConfig] ?? planConfig.free

  return (
    <div className={cn('rounded-xl border px-6 py-5', cfg.border, cfg.bg)}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#888888] mb-2 uppercase tracking-widest font-medium">
            {cfg.icon}
            Current Plan
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-semibold text-white capitalize">{cfg.label}</span>
            <Badge tone={cfg.badgeTone}>{isLive ? 'Active' : isTrial ? 'Trial' : 'Free'}</Badge>
          </div>
          {isLoading ? (
            <div className="mt-2"><Spinner className="h-4 w-4" /></div>
          ) : subData ? (
            <div className="mt-1 text-sm text-[#888888]">
              {subData.currentPeriodEnd && (
                <span>Renews {new Date(subData.currentPeriodEnd).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              )}
              {subData.trialEndsAt && !isLive && (
                <span>Trial ends {new Date(subData.trialEndsAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              )}
              {subData.seatCount > 0 && (
                <span className="ml-3">{subData.seatCount} seat{subData.seatCount === 1 ? '' : 's'}</span>
              )}
            </div>
          ) : null}
        </div>
        {isLive && (
          <Button variant="secondary" disabled={busy} onClick={onCancel} size="sm">
            Cancel at period end
          </Button>
        )}
      </div>
    </div>
  )
}

/* ── UPGRADE CARD ── */
function UpgradeCard({
  seatCount,
  setSeatCount,
  memberCount,
  busy,
  onCheckout,
  isTrial,
}: {
  seatCount: number
  setSeatCount: (n: number) => void
  memberCount: number
  busy: boolean
  onCheckout: () => void
  isTrial: boolean
}) {
  const monthlyUsd = seatCount * 19
  const monthlyInr = seatCount * 1600

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upgrade to Pro</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Seat selector */}
          <div>
            <div className="text-sm font-medium text-white mb-3">Configure your plan</div>
            <label className="block mb-1 text-xs text-[#888888]">Number of developer seats</label>
            <Input
              type="number"
              min={1}
              max={500}
              value={seatCount}
              onChange={(e) => setSeatCount(Math.max(1, Number(e.target.value)))}
              className="w-32"
            />
            <div className="mt-3 rounded-lg bg-[#0a0a0a] border border-[#222] px-4 py-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-[#888888]">{seatCount} seat{seatCount === 1 ? '' : 's'} × ₹1,600</span>
                <span className="text-white font-medium tabular-nums">₹{monthlyInr.toLocaleString('en-IN')}/mo</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#888888]">{seatCount} seat{seatCount === 1 ? '' : 's'} × $19</span>
                <span className="text-white font-medium tabular-nums">${monthlyUsd}/mo</span>
              </div>
              {memberCount > 0 && seatCount < memberCount && (
                <div className="text-xs text-yellow-400 pt-1">
                  You have {memberCount} team members — consider adding more seats.
                </div>
              )}
            </div>
            <div className="mt-4">
              <Button disabled={busy} onClick={onCheckout} size="lg" className="w-full sm:w-auto">
                {busy ? 'Opening checkout…' : isTrial ? 'Upgrade from trial' : 'Start subscription'}
              </Button>
              <div className="mt-2 text-xs text-[#555555]">
                Powered by Razorpay · Cancel anytime · 14-day free trial included
              </div>
            </div>
          </div>

          {/* Pro features */}
          <div>
            <div className="text-sm font-medium text-white mb-3">What's included</div>
            <ul className="space-y-2">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-[#888888]">
                  <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── PLAN COMPARISON ── */
function PlanComparison({ isPro }: { isPro: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan comparison</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Free */}
          <div className={cn('rounded-lg border p-4', !isPro ? 'border-green-500/30 bg-green-500/5' : 'border-[#222]')}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-white">Free</div>
              {!isPro && <Badge tone="green">Current</Badge>}
            </div>
            <div className="text-2xl font-bold text-white mb-4">$0<span className="text-sm font-normal text-[#888888]">/mo</span></div>
            <ul className="space-y-2">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-[#888888]">
                  <Check className="h-3.5 w-3.5 text-[#555555] flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Pro */}
          <div className={cn('rounded-lg border p-4', isPro ? 'border-green-500/30 bg-green-500/5' : 'border-[#222]')}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-white">Pro</div>
              {isPro && <Badge tone="green">Current</Badge>}
            </div>
            <div className="text-2xl font-bold text-white mb-4">
              $19<span className="text-sm font-normal text-[#888888]">/seat/mo</span>
            </div>
            <ul className="space-y-2">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-[#888888]">
                  <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

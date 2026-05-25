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
import { cn, planDisplayLabel } from '../lib/utils.js'

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

type PlanId = 'starter' | 'team' | 'business'

const PLAN_OPTIONS = [
  {
    id: 'starter' as PlanId,
    name: 'Starter',
    priceUsd: 49,
    includedSeats: 10,
    extraPerSeat: 5,
    best: 'Best for 1–10 devs',
    popular: false,
    features: [
      'All repos monitored',
      'AI PR detection (label, git trailer & body)',
      'Weekly ROI verdict: Net Positive / Neutral / Negative',
      'Problem PR alerts with AI root-cause summaries',
      'Seat waste analysis',
      'Codebase health score & trend',
      'Outcomes tracking (reverts, hotfixes)',
      'Weekly email digest',
      'Slack weekly digest + instant alerts',
      'GitHub App · 5-minute setup',
      'Email support',
    ],
  },
  {
    id: 'team' as PlanId,
    name: 'Growth',
    priceUsd: 149,
    includedSeats: 30,
    extraPerSeat: 4,
    best: 'Best for 11–30 devs',
    popular: true,
    features: [
      'Everything in Starter',
      'Per-developer seat waste breakdown',
      'AI adoption rate by team member',
      'Tool comparison (Copilot vs Cursor vs Claude Code)',
      'Developer metrics & trend analysis',
      'Journey milestones tracker',
      'Priority email support',
    ],
  },
  {
    id: 'business' as PlanId,
    name: 'Business',
    priceUsd: 399,
    includedSeats: 75,
    extraPerSeat: 3,
    best: 'Best for 31–75 devs',
    popular: false,
    features: [
      'Everything in Growth',
      'Security overview & audit log',
      'Custom data retention policy',
      'Dedicated onboarding session',
      '24h support SLA',
    ],
  },
]

function suggestPlan(memberCount: number): PlanId {
  if (memberCount <= 10) return 'starter'
  if (memberCount <= 30) return 'team'
  return 'business'
}

export function BillingPage() {
  const [searchParams] = useSearchParams()
  const justSucceeded = searchParams.get('subscribed') === '1'
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(justSucceeded)
  const sub = useQuery({ queryKey: ['subscription'], queryFn: api.billing.subscription })
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const members = useQuery({ queryKey: ['members'], queryFn: api.team.members })
  const summary = useQuery({ queryKey: ['metrics', 'summary'], queryFn: api.metrics.summary })
  const seatWaste = useQuery({ queryKey: ['analytics', 'seat-waste'], queryFn: api.analytics.seatWaste })
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.get })
  const qc = useQueryClient()
  const memberCount = members.data?.length ?? 1
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(() => suggestPlan(memberCount))
  const [extraSeats, setExtraSeats] = useState(0)
  const [busy, setBusy] = useState(false)

  const isLive =
    sub.data?.status === 'active' ||
    sub.data?.status === 'authenticated' ||
    sub.data?.status === 'pending'

  const { plan, isPaid: isPro, isTrial } = usePlan()

  const planConfig = PLAN_OPTIONS.find((p) => p.id === selectedPlan)!
  const totalSeats = planConfig.includedSeats + extraSeats
  const totalUsd = planConfig.priceUsd + extraSeats * planConfig.extraPerSeat

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
      const order = await api.billing.checkout(selectedPlan, totalSeats)
      const options: RazorpayOrderOptions = {
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'Grassion',
        description: `Grassion ${planConfig.name} · ${totalSeats} developer seat${totalSeats === 1 ? '' : 's'}`,
        image: '/W+L.png',
        prefill: {
          email: me.data?.user.email ?? undefined,
          name: me.data?.user.githubLogin,
        },
        theme: { color: '#22c55e' },
        modal: { ondismiss: () => setBusy(false) },
        handler: async (resp: RazorpayOrderResponse) => {
          try {
            await api.billing.verify({
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_signature: resp.razorpay_signature,
              seatCount: totalSeats,
              plan: selectedPlan,
            })
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
      {isPro && !success && (
        <div className="flex items-center gap-3 rounded-xl border border-white/20 bg-white/5 px-6 py-4">
          <Check className="h-5 w-5 text-white flex-shrink-0" />
          <div>
            <div className="text-sm font-semibold text-white">
              Your plan: {planDisplayLabel(plan)}
            </div>
            <div className="text-xs text-[#888888] mt-0.5">
              All features are active. Manage your subscription below.
            </div>
          </div>
        </div>
      )}

      {success && (
        <Alert tone="green">
          Payment successful! Your plan has been upgraded.
        </Alert>
      )}
      {error && <Alert tone="red">{error}</Alert>}

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

      {!isPro && (
        <UpgradeCard
          selectedPlan={selectedPlan}
          setSelectedPlan={(p) => {
            setSelectedPlan(p)
            setExtraSeats(0)
          }}
          extraSeats={extraSeats}
          setExtraSeats={setExtraSeats}
          totalSeats={totalSeats}
          totalUsd={totalUsd}
          memberCount={memberCount}
          busy={busy}
          onCheckout={startCheckout}
          isTrial={isTrial}
        />
      )}

      <RoiSavings
        summaryData={summary.data}
        seatWasteData={seatWaste.data}
        monthlySpend={team.data?.monthlyAiSpendUsd ?? 0}
      />

      {(isPro || isLive) && sub.data && (
        <SubscriptionReceipt subData={sub.data} plan={plan ?? 'starter'} />
      )}

      <PlanComparison plan={plan ?? 'trial'} />
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
    starter:  { border: 'border-white/20', bg: 'bg-white/5', icon: <Star className="h-5 w-5 text-white" />, badgeTone: 'green' as const, label: 'Starter' },
    team:     { border: 'border-white/20', bg: 'bg-white/5', icon: <Star className="h-5 w-5 text-white" />, badgeTone: 'green' as const, label: 'Growth' },
    business: { border: 'border-white/20', bg: 'bg-white/5', icon: <Star className="h-5 w-5 text-white" />, badgeTone: 'green' as const, label: 'Business' },
    pro:      { border: 'border-white/20', bg: 'bg-white/5', icon: <Star className="h-5 w-5 text-white" />, badgeTone: 'green' as const, label: 'Pro' },
    admin:    { border: 'border-white/20', bg: 'bg-white/5', icon: <Star className="h-5 w-5 text-white" />, badgeTone: 'green' as const, label: 'Pro' },
    trial:    { border: 'border-yellow-500/40', bg: 'bg-yellow-500/5', icon: <Zap className="h-5 w-5 text-yellow-400" />, badgeTone: 'yellow' as const, label: '14-day Trial' },
    free:     { border: 'border-[#333]', bg: 'bg-white/2', icon: <Shield className="h-5 w-5 text-[#888888]" />, badgeTone: 'gray' as const, label: 'Free' },
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
            <Badge tone={cfg.badgeTone}>{isPro || isLive ? 'Active' : isTrial ? 'Trial' : 'Free'}</Badge>
          </div>
          {isLoading ? (
            <div className="mt-2"><Spinner className="h-4 w-4" /></div>
          ) : subData ? (
            <div className="mt-1 text-sm text-[#888888]">
              {subData.currentPeriodEnd && (
                <span>Renews {new Date(subData.currentPeriodEnd).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              )}
              {subData.trialEndsAt && !isLive && !isPro && (
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
  selectedPlan,
  setSelectedPlan,
  extraSeats,
  setExtraSeats,
  totalSeats,
  totalUsd,
  memberCount,
  busy,
  onCheckout,
  isTrial,
}: {
  selectedPlan: PlanId
  setSelectedPlan: (p: PlanId) => void
  extraSeats: number
  setExtraSeats: (n: number) => void
  totalSeats: number
  totalUsd: number
  memberCount: number
  busy: boolean
  onCheckout: () => void
  isTrial: boolean
}) {
  const plan = PLAN_OPTIONS.find((p) => p.id === selectedPlan)!

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PLAN_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSelectedPlan(opt.id)}
              className={cn(
                'relative text-left rounded-lg border p-4 transition-colors focus:outline-none',
                selectedPlan === opt.id
                  ? 'border-green-500/50 bg-green-500/5'
                  : 'border-[#222] hover:border-[#444]',
              )}
            >
              {opt.popular && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-black">
                  Popular
                </span>
              )}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#888888]">{opt.name}</span>
                {selectedPlan === opt.id && <Check className="h-3.5 w-3.5 text-green-500" />}
              </div>
              <div className="text-2xl font-bold text-white">${opt.priceUsd}</div>
              <div className="text-xs text-[#555] mt-0.5">/mo · {opt.includedSeats} seats incl.</div>
              <div className="text-xs text-[#444] mt-1">${opt.extraPerSeat}/seat extra</div>
              <div className="text-xs text-[#444] mt-2">{opt.best}</div>
            </button>
          ))}
        </div>

        {/* Extra seats */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div>
            <label className="block text-xs text-[#888888] mb-1.5">
              Extra seats beyond {plan.includedSeats} included
            </label>
            <Input
              type="number"
              min={0}
              max={500}
              value={extraSeats}
              onChange={(e) => setExtraSeats(Math.max(0, Number(e.target.value)))}
              className="w-28"
            />
          </div>
          <div className="rounded-lg bg-[#0a0a0a] border border-[#222] px-4 py-3 flex-1">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-[#888888]">{plan.name} base ({plan.includedSeats} seats)</span>
              <span className="text-white font-medium tabular-nums">${plan.priceUsd}/mo</span>
            </div>
            {extraSeats > 0 && (
              <div className="flex justify-between text-sm mb-1">
                <span className="text-[#888888]">{extraSeats} extra seat{extraSeats === 1 ? '' : 's'} × ${plan.extraPerSeat}</span>
                <span className="text-white font-medium tabular-nums">+${extraSeats * plan.extraPerSeat}/mo</span>
              </div>
            )}
            <div className="flex justify-between text-sm border-t border-[#1a1a1a] pt-2 mt-1">
              <span className="text-white font-semibold">Total · {totalSeats} seats</span>
              <span className="text-green-400 font-bold tabular-nums">${totalUsd}/mo</span>
            </div>
            {memberCount > totalSeats && (
              <div className="text-xs text-yellow-400 pt-2">
                You have {memberCount} members — consider adding {memberCount - totalSeats} more seat{memberCount - totalSeats === 1 ? '' : 's'}.
              </div>
            )}
          </div>
        </div>

        {/* Features */}
        <div>
          <div className="text-xs font-medium text-[#888888] uppercase tracking-wider mb-3">
            What's included in {plan.name}
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {plan.features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-[#888888]">
                <Check className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <Button disabled={busy} onClick={onCheckout} size="lg" className="w-full sm:w-auto">
            {busy ? 'Opening checkout…' : isTrial ? `Upgrade to ${plan.name} — $${totalUsd}/mo` : `Subscribe to ${plan.name} — $${totalUsd}/mo`}
          </Button>
          <div className="mt-2 text-xs text-[#555555]">
            Billed in USD via Razorpay · Cancel anytime
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── PLAN COMPARISON ── */
function PlanComparison({ plan }: { plan: string }) {
  const isStarter = ['starter', 'pro', 'admin'].includes(plan)
  const isGrowth = plan === 'team'
  const isBusiness = plan === 'business'

  type Tier = {
    name: string
    price: string
    seats: string
    extra: string
    best: string
    features: string[]
    inherited: string | null
    cta: string
    ctaHref?: string
    isCurrent: boolean
    isFeatured: boolean
  }

  const tiers: Tier[] = [
    {
      name: 'Starter',
      price: '$49',
      seats: '10 seats incl.',
      extra: '$5/seat extra',
      best: 'Best for 1–10 devs',
      features: [
        'All repos monitored',
        'AI PR detection',
        'Weekly ROI verdict',
        'Problem PR alerts + AI summaries',
        'Seat waste analysis',
        'Health score & codebase trends',
        'Weekly email + Slack digest',
      ],
      inherited: null,
      cta: isStarter ? 'Current plan' : 'Upgrade',
      isCurrent: isStarter,
      isFeatured: false,
    },
    {
      name: 'Growth',
      price: '$149',
      seats: '30 seats incl.',
      extra: '$4/seat extra',
      best: 'Best for 11–30 devs',
      features: [
        'Per-developer seat breakdown',
        'AI adoption by team member',
        'Tool comparison dashboard',
        'Developer metrics & trends',
        'Journey milestones tracker',
        'Priority support',
      ],
      inherited: 'Everything in Starter',
      cta: isGrowth ? 'Current plan' : 'Contact sales',
      ctaHref: isGrowth ? undefined : 'mailto:info@grassion.com?subject=Growth plan',
      isCurrent: isGrowth,
      isFeatured: true,
    },
    {
      name: 'Business',
      price: '$399',
      seats: '75 seats incl.',
      extra: '$3/seat extra',
      best: 'Best for 31–75 devs',
      features: [
        'Security overview & audit log',
        'Custom data retention',
        'Dedicated onboarding session',
        '24h support SLA',
      ],
      inherited: 'Everything in Growth',
      cta: isBusiness ? 'Current plan' : 'Contact sales',
      ctaHref: isBusiness ? undefined : 'mailto:info@grassion.com?subject=Business plan',
      isCurrent: isBusiness,
      isFeatured: false,
    },
    {
      name: 'Enterprise',
      price: 'Contact us',
      seats: 'Unlimited seats',
      extra: 'Tailored pricing',
      best: '75+ devs',
      features: [
        'Custom contract & SLA',
        'Dedicated account manager',
        'On-premise deployment option',
      ],
      inherited: 'Everything in Business',
      cta: 'Contact sales',
      ctaHref: 'mailto:info@grassion.com?subject=Enterprise plan',
      isCurrent: false,
      isFeatured: false,
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan comparison</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={cn(
                'rounded-lg border p-4 flex flex-col',
                tier.isCurrent ? 'border-green-500/30 bg-green-500/5' : tier.isFeatured ? 'border-white/20 bg-white/3' : 'border-[#222]',
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#888888]">{tier.name}</div>
                {tier.isCurrent && <Badge tone="green">Current</Badge>}
                {tier.isFeatured && !tier.isCurrent && <Badge tone="gray">Popular</Badge>}
              </div>
              <div className="mb-1">
                <span className="text-2xl font-bold text-white">{tier.price}</span>
                <span className="text-xs text-[#555555] ml-1">/mo</span>
              </div>
              <div className="text-xs text-[#666] mb-0.5">{tier.seats}</div>
              <div className="text-xs text-[#444] mb-3">{tier.extra}</div>
              <div className="text-xs text-[#555555] mb-4">{tier.best}</div>
              <ul className="space-y-1.5 flex-1 mb-4">
                {tier.inherited && (
                  <li className="flex items-start gap-2 text-xs text-[#444444] italic">
                    <span className="mt-0.5 flex-shrink-0">↳</span>
                    {tier.inherited}
                  </li>
                )}
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-[#888888]">
                    <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              {tier.ctaHref ? (
                <a
                  href={tier.ctaHref}
                  className="block text-center rounded-md border border-[#333] px-3 py-2 text-xs font-medium text-[#888888] hover:text-white hover:border-white/40 transition-colors"
                >
                  {tier.cta}
                </a>
              ) : (
                <div className={cn('text-center rounded-md px-3 py-2 text-xs font-medium', tier.isCurrent ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'border border-[#333] text-[#555]')}>
                  {tier.cta}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/* ── ROI SAVINGS ── */
function RoiSavings({
  summaryData,
  seatWasteData,
  monthlySpend,
}: {
  summaryData: import('@grassion/shared').DashboardSummary | undefined
  seatWasteData: import('../lib/api.js').SeatWasteResponse | undefined
  monthlySpend: number
}) {
  const saved = summaryData?.estimatedDollarSaved ?? 0
  const lost = summaryData?.estimatedDollarLost ?? 0
  const net = summaryData?.netDollar ?? 0
  const inactiveSeats = seatWasteData?.inactiveUsers.length ?? 0
  const seatSavingsPotential = seatWasteData?.totalMonthlySavings ?? 0
  const aiPrs = summaryData?.totalPrs ?? 0

  const rows: { label: string; value: string; color?: string }[] = [
    { label: 'Monthly AI tool spend', value: monthlySpend > 0 ? `$${monthlySpend.toFixed(0)}/mo` : '—' },
    { label: 'Estimated value delivered (this week)', value: saved > 0 ? `+$${saved.toFixed(0)}` : '—', color: saved > 0 ? 'text-green-400' : undefined },
    { label: 'Estimated rework cost (this week)', value: lost > 0 ? `-$${lost.toFixed(0)}` : '—', color: lost > 0 ? 'text-red-400' : undefined },
    { label: 'Net ROI (this week)', value: aiPrs > 0 ? `${net >= 0 ? '+' : ''}$${net.toFixed(0)}` : '—', color: net >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: `Unused AI seats (${inactiveSeats} devs)`, value: seatSavingsPotential > 0 ? `$${seatSavingsPotential}/mo recoverable` : '—', color: seatSavingsPotential > 0 ? 'text-yellow-400' : undefined },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>ROI &amp; Savings</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-[#555555] mb-4">
          Savings are estimated based on your hourly rate setting and AI PR merge time vs baseline.
          Set your monthly spend and hourly rate in{' '}
          <a href="/settings" className="underline hover:text-white transition-colors">Settings → ROI calibration</a>{' '}
          for accurate numbers.
        </p>
        <div className="divide-y divide-[#1a1a1a]">
          {rows.map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between py-3">
              <span className="text-sm text-[#888888]">{label}</span>
              <span className={cn('text-sm font-medium tabular-nums', color ?? 'text-white')}>{value}</span>
            </div>
          ))}
        </div>
        {aiPrs < 5 && (
          <p className="mt-4 text-xs text-[#555555] rounded-lg bg-[#0a0a0a] border border-[#1a1a1a] px-3 py-2">
            Merge at least 5 AI-assisted PRs this week to unlock ROI calculations.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/* ── SUBSCRIPTION RECEIPT ── */
function SubscriptionReceipt({
  subData,
  plan,
}: {
  subData: import('@grassion/shared').SubscriptionDto
  plan: string
}) {
  const PLAN_CONFIG: Record<string, { base: number; included: number; extra: number; name: string }> = {
    starter:  { base: 49,  included: 10, extra: 5, name: 'Starter' },
    team:     { base: 149, included: 30, extra: 4, name: 'Growth' },
    business: { base: 399, included: 75, extra: 3, name: 'Business' },
    pro:      { base: 49,  included: 10, extra: 5, name: 'Pro' },
    admin:    { base: 49,  included: 10, extra: 5, name: 'Pro' },
  }
  const config = PLAN_CONFIG[plan]
  const seats = subData.seatCount > 0 ? subData.seatCount : (config?.included ?? 1)
  const extraSeats = config ? Math.max(0, seats - config.included) : 0
  const monthly = config ? config.base + extraSeats * config.extra : seats * 19

  const rows = [
    { label: 'Plan', value: config?.name ?? plan },
    { label: `${config?.included ?? seats} included seats`, value: `$${config?.base ?? monthly}/mo` },
    ...(extraSeats > 0 ? [{ label: `${extraSeats} extra seat${extraSeats === 1 ? '' : 's'} × $${config?.extra ?? 0}`, value: `+$${extraSeats * (config?.extra ?? 0)}/mo` }] : []),
    {
      label: 'Next billing date',
      value: subData.currentPeriodEnd
        ? new Date(subData.currentPeriodEnd).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : '—',
    },
    { label: 'Payment method', value: 'Razorpay · Card / UPI' },
    { label: 'Billing currency', value: 'USD' },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-[#1a1a1a]">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between py-3">
              <span className="text-sm text-[#888888]">{label}</span>
              <span className="text-sm font-medium text-white tabular-nums">{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-[#0a0a0a] border border-[#222] px-4 py-3">
          <span className="text-sm font-semibold text-white">Total per month</span>
          <span className="text-lg font-bold text-white tabular-nums">${monthly}</span>
        </div>
        <p className="mt-3 text-xs text-[#555555]">
          To update seat count or plan, contact{' '}
          <a href="mailto:info@grassion.com" className="underline hover:text-white transition-colors">info@grassion.com</a>{' '}
          or use the Cancel button above.
        </p>
      </CardContent>
    </Card>
  )
}

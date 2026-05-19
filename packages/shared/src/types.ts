export type AiSource = 'copilot' | 'cursor' | 'claude' | 'windsurf' | 'unknown_ai'
export type AiDetectionMethod = 'trailer' | 'body_regex' | 'label' | 'manual'
export type Plan = 'trial' | 'starter' | 'team' | 'business'
export type Role = 'owner' | 'admin' | 'member'
export type Verdict = 'net_positive' | 'net_negative' | 'unclear' | 'insufficient_data'
export type PrState = 'open' | 'merged' | 'closed'

export interface DashboardSummary {
  weekStart: string
  totalPrs: number
  aiPrs: number
  humanPrs: number
  speedDeltaPercent: number
  reworkMultiplier: number
  monthlySpend: number
  estimatedDollarSaved: number
  estimatedDollarLost: number
  netDollar: number
  verdict: Verdict
}

export interface ProblemPRDto {
  id: string
  number: number
  title: string
  url: string
  reason: string
  aiSummary: string | null
  reworkScore: number
  aiSource: AiSource | null
  mergedAt: string
}

export interface WeeklyMetricDto {
  weekStart: string
  totalPrs: number
  aiPrs: number
  humanPrs: number
  aiAvgMergeHours: number | null
  humanAvgMergeHours: number | null
  aiReworkRate: number | null
  humanReworkRate: number | null
  estimatedDollarSaved: number
  estimatedDollarLost: number
  netDollar: number
  verdict: Verdict
}

export interface MeResponse {
  user: {
    id: string
    githubLogin: string
    email: string | null
    avatarUrl: string | null
    role: Role
  }
  team: {
    id: string
    name: string
    slug: string
    plan: Plan
    trialEndsAt: string | null
    githubInstallationId: number | null
    monthlyAiSpendUsd: number
    avgDevHourlyRateUsd: number
    timezone: string
    emailDigestEnabled: boolean
  }
}

export interface RepoDto {
  id: string
  owner: string
  name: string
  defaultBranch: string | null
  isActive: boolean
  connectedAt: string
}

export interface MemberDto {
  id: string
  githubLogin: string
  email: string | null
  avatarUrl: string | null
  role: Role
  createdAt: string
}

export type SubscriptionStatus =
  | 'none'
  | 'created'
  | 'authenticated'
  | 'pending'
  | 'active'
  | 'paused'
  | 'halted'
  | 'cancelled'
  | 'completed'
  | 'expired'

export interface SubscriptionDto {
  plan: Plan
  status: SubscriptionStatus | string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  seatCount: number
}

export interface CreateSubscriptionResponse {
  subscriptionId: string
  razorpayKey: string
  planId: string
  seatCount: number
}

export interface CheckoutOrderResponse {
  orderId: string
  keyId: string
  amount: number
  currency: string
  seatCount: number
}

import type {
  DashboardSummary,
  WeeklyMetricDto,
  MeResponse,
  RepoDto,
  ProblemPRDto,
  MemberDto,
  SubscriptionDto,
  CreateSubscriptionResponse,
  CheckoutOrderResponse,
  ContactInput,
} from '@grassion/shared'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('grassion_token')
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 401) {
    localStorage.removeItem('grassion_token')
    throw new ApiError(401, 'unauthorized')
  }
  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      // ignore
    }
    throw new ApiError(res.status, (body as { error?: string })?.error ?? `http_${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface SeatWasteUser {
  githubLogin: string
  avatarUrl: string | null
  lastActivity: string | null
}

export interface SeatWasteResponse {
  totalSeats: number
  activeUsers: Array<SeatWasteUser & { weeklyAiPrs: number }>
  inactiveUsers: Array<SeatWasteUser & { monthlyCost: number }>
  totalMonthlySavings: number
}

export interface SavingsHistoryResponse {
  totalWasteIdentified: number
  thisMonthWaste: number
  monthlyHistory: Array<{ month: string; wasteUsd: number }>
}

export interface OutcomesToolRow {
  tool: string
  prCount: number
  revertedCount: number
  revertRate: number
  hotfixCount: number
  hotfixRate: number
  avgChangesRequested: number
  qualityScore: number
  estimatedMonthlySpend: number
  verdict: 'high_quality' | 'average' | 'low_quality'
}

export interface OutcomesResponse {
  totalAiPrs: number
  revertedAiPrs: number
  revertRate: number
  hotfixRate: number
  avgReviewChangesRequested: number
  aiPrQualityScore: number
  verdict: 'high_quality' | 'average' | 'low_quality'
  toolBreakdown: OutcomesToolRow[]
}

export interface HealthDevRow {
  githubLogin: string
  avatarUrl: string | null
  weeklyAiPrs: number
  totalAiPrs: number
  qualityScore: number
  primaryTool: string | null
  trend: 'up' | 'stable' | 'down'
  status: 'power_user' | 'active' | 'needs_support'
}

export interface HealthResponse {
  healthScore: number
  riskLevel: 'low' | 'medium' | 'high'
  weekCount: number
  revertRate: number
  hotfixRate: number
  avgReviewCycles: number
  totalAiPrs: number
  trend: Array<{ weekStart: string; score: number; totalAiPrs: number }>
  developers: HealthDevRow[]
  riskSignals: Array<{ type: string; description: string }>
}

export interface JourneyResponse {
  daysConnected: number
  totalWasteIdentified: number
  bestWeekRoi: number
  firstAdoption: number
  latestAdoption: number
  milestones: Array<{ type: string; label: string; achievedAt: string }>
}

export interface PrOutcomeItem {
  prId: string
  prNumber: number
  prTitle: string
  authorLogin: string | null
  mergedAt: string | null
  aiSource: string | null
  wasReverted: boolean | null
  revertedAt: string | null
  revertPrNumber: number | null
  ciFailureCount: number
  downstreamFixCount: number
  hadHotfixWithin7d: boolean | null
  reworkScore: number
  aiSummary: string | null
  computedAt: string
}

export interface NotificationItem {
  id: string
  teamId: string
  type: string
  title: string
  body: string
  link: string | null
  sourceId: string | null
  readAt: string | null
  createdAt: string
}

export interface SecurityOverview {
  userId: string
  role: string
  activeSessionCount: number
  connectedRepos: Array<{ name: string; connectedAt: string }>
  milestones: Array<{ type: string; achievedAt: string }>
  githubPermissions: Array<{ scope: string; description: string }>
  dataAccess: { reads: string[]; neverReads: string[] }
}

export interface DeveloperMetricsRow {
  githubLogin: string
  weeklyData: Array<{
    weekStart: string
    totalPrs: number | null
    aiPrs: number | null
    revertedPrs: number | null
    hotfixPrs: number | null
    qualityScore: number | null
    isActive: boolean | null
    primaryAiTool: string | null
  }>
  trend: 'improving' | 'stable' | 'declining'
  qualityScore: number
  isPowerUser: boolean
  primaryTool: string | null
  isActive: boolean | null
}

export interface ToolComparisonRow {
  toolName: string
  totalPrs: number
  qualityScore: number
  estimatedSpend: number
  revertRate: number
  activeUsers: number
  verdict: 'strong_roi' | 'medium_roi' | 'low_roi'
}

export interface CodebaseHealthResponse {
  current: {
    healthScore: number
    riskLevel: string
    trend: 'improving' | 'stable' | 'declining'
    aiAdoptionPct: number
    revertRatePct: number
  } | null
  history: Array<{ date: string; healthScore: number; riskLevel: string }>
}

export interface HistoryRow {
  weekStart: string
  totalSeats: number
  activeSeats: number
  inactiveSeats: number
  aiPrs: number
  totalPrs: number
  aiAdoptionPct: number
  monthlyWasteUsd: number
  netRoiUsd: number
  verdict: string
}

export const api = {
  me: () => request<MeResponse>('/auth/me'),
  logout: async () => {
    localStorage.removeItem('grassion_token')
    return request<{ ok: true }>('/auth/logout', { method: 'POST' })
  },

  team: {
    get: () => request<MeResponse['team']>('/api/team'),
    update: (body: Partial<MeResponse['team']>) =>
      request<{ ok: true }>('/api/team', { method: 'PATCH', body: JSON.stringify(body) }),
    members: () => request<MemberDto[]>('/api/team/members'),
    removeMember: (id: string) =>
      request<{ ok: true }>(`/api/team/members/${id}`, { method: 'DELETE' }),
  },

  repos: {
    list: () => request<RepoDto[]>('/api/repos'),
    available: () => request<Array<{ fullName: string; name: string; owner: string; private: boolean; description: string | null; alreadyConnected: boolean }>>('/api/repos/available'),
    toggle: (id: string, isActive: boolean) =>
      request<{ ok: true }>(`/api/repos/${id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ isActive }),
      }),
    connect: (repoUrl: string) =>
      request<{ ok: true; repoName: string; prsSynced: number; alreadyConnected?: boolean }>('/api/repos/connect', {
        method: 'POST',
        body: JSON.stringify({ repoUrl }),
      }),
    disconnect: (id: string) =>
      request<{ ok: true }>(`/api/repos/${id}`, { method: 'DELETE' }),
    sync: (id: string) =>
      request<{ ok: true; prsSynced: number }>(`/api/repos/sync/${id}`, { method: 'POST' }),
  },

  admin: {
    triggerDigest: () =>
      request<{ ok: true; sent: number; failed: number }>('/api/admin/trigger-digest', { method: 'POST' }),
  },

  slack: {
    test: () => request<{ ok: true }>('/api/slack/test', { method: 'POST' }),
  },

  metrics: {
    summary: () => request<DashboardSummary>('/api/metrics/summary'),
    weekly: () => request<WeeklyMetricDto[]>('/api/metrics/weekly'),
    history: () => request<HistoryRow[]>('/api/metrics/history'),
  },

  analytics: {
    seatWaste: () => request<SeatWasteResponse>('/api/analytics/seat-waste'),
    savingsHistory: () => request<SavingsHistoryResponse>('/api/analytics/savings-history'),
    journey: () => request<JourneyResponse>('/api/analytics/journey'),
    outcomes: () => request<OutcomesResponse>('/api/analytics/outcomes'),
    health: () => request<HealthResponse>('/api/analytics/health'),
    prOutcomes: (filter?: string) =>
      request<PrOutcomeItem[]>(`/api/analytics/pr-outcomes${filter && filter !== 'all' ? `?filter=${filter}` : ''}`),
    developerMetrics: () => request<{ developers: DeveloperMetricsRow[] }>('/api/analytics/developer-metrics'),
    toolComparison: () => request<{ tools: ToolComparisonRow[] }>('/api/analytics/tool-comparison'),
    codbaseHealth: () => request<CodebaseHealthResponse>('/api/analytics/codebase-health'),
  },

  notifications: {
    list: () => request<NotificationItem[]>('/api/notifications'),
    markRead: (id: string) => request<{ ok: true }>(`/api/notifications/${id}/read`, { method: 'POST' }),
    markAllRead: () => request<{ ok: true }>('/api/notifications/read-all', { method: 'POST' }),
  },

  security: {
    overview: () => request<SecurityOverview>('/api/security/overview'),
  },

  prs: {
    problem: () => request<ProblemPRDto[]>('/api/prs/problem'),
  },

  billing: {
    /** Order-based checkout (primary flow). Creates a Razorpay Order for the selected plan + extra seats. */
    checkout: (plan: 'starter' | 'team' | 'business', seatCount: number) =>
      request<CheckoutOrderResponse>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan, seatCount }),
      }),
    /** Legacy subscription-based checkout. Requires RAZORPAY_PLAN_ID_STARTER on the server. */
    subscribe: (seatCount: number) =>
      request<CreateSubscriptionResponse>('/api/billing/subscribe', {
        method: 'POST',
        body: JSON.stringify({ seatCount }),
      }),
    /** Verifies a completed payment. Accepts either order-based or subscription-based fields. */
    verify: (payload:
      | { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string; seatCount?: number; plan?: string }
      | { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }
    ) =>
      request<{ ok: true; status: string; plan?: string }>('/api/billing/verify', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    cancel: () =>
      request<{ ok: true; status: string }>('/api/billing/cancel', { method: 'POST' }),
    subscription: () => request<SubscriptionDto>('/api/billing/subscription'),
  },

  contact: (body: ContactInput) =>
    request<{ ok: true }>('/api/contact', { method: 'POST', body: JSON.stringify(body) }),
}

export function loginUrl(): string {
  return `${API_URL}/auth/github`
}

export function installUrl(slug = 'grassion'): string {
  return `https://github.com/apps/${slug}/installations/new`
}

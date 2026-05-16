import type {
  DashboardSummary,
  WeeklyMetricDto,
  MeResponse,
  RepoDto,
  ProblemPRDto,
  MemberDto,
  SubscriptionDto,
  CreateSubscriptionResponse,
  ContactInput,
} from '@grassion/shared'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 401) {
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

export const api = {
  me: () => request<MeResponse>('/auth/me'),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

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
    toggle: (id: string, isActive: boolean) =>
      request<{ ok: true }>(`/api/repos/${id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ isActive }),
      }),
  },

  metrics: {
    summary: () => request<DashboardSummary>('/api/metrics/summary'),
    weekly: () => request<WeeklyMetricDto[]>('/api/metrics/weekly'),
  },

  analytics: {
    seatWaste: () => request<SeatWasteResponse>('/api/analytics/seat-waste'),
  },

  prs: {
    problem: () => request<ProblemPRDto[]>('/api/prs/problem'),
  },

  billing: {
    subscribe: (seatCount: number) =>
      request<CreateSubscriptionResponse>('/api/billing/subscribe', {
        method: 'POST',
        body: JSON.stringify({ seatCount }),
      }),
    verify: (payload: {
      razorpay_payment_id: string
      razorpay_subscription_id: string
      razorpay_signature: string
    }) =>
      request<{ ok: true; status: string }>('/api/billing/verify', {
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

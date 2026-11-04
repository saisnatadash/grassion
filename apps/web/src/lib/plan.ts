import { useQuery } from '@tanstack/react-query'
import type { Plan } from '@grassion/shared'
import { api } from './api.js'
import { decodePlanFromToken } from './utils.js'

const PRO_PLANS = ['pro', 'starter', 'growth', 'team', 'business', 'enterprise', 'admin']
const BUSINESS_PLANS = ['business', 'enterprise', 'admin']

export function isProPlan(plan: Plan | string | null | undefined): boolean {
  if (!plan) return false
  return PRO_PLANS.includes(plan)
}

export function isPaidPlan(plan: Plan | string | null | undefined): boolean {
  return isProPlan(plan)
}

// Legacy aliases kept for existing call-sites.
export function isTeamPlan(plan: Plan | string | null | undefined): boolean {
  return isProPlan(plan)
}

export function isBusinessPlan(plan: Plan | string | null | undefined): boolean {
  if (!plan) return false
  return BUSINESS_PLANS.includes(plan)
}

export interface UsePlanResult {
  plan: Plan | null
  isPaid: boolean
  isPro: boolean
  isTrial: boolean
  isFree: boolean
  isTeam: boolean
  isBusiness: boolean
  isLoading: boolean
}

/**
 * Returns the current user's plan, always sourced from the DB.
 * Priority: /api/team response > /auth/me response > stale JWT claim.
 * The JWT is only used as the instant first-render value before any fetch
 * completes — once either server query resolves, the DB value takes over.
 */
export function usePlan(): UsePlanResult {
  const jwtPlan = decodePlanFromToken()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.get })
  // Both me and team read plan from the DB (not JWT). team query wins if both resolve.
  const plan = (team.data?.plan ?? me.data?.team.plan ?? jwtPlan) as Plan | null

  return {
    plan,
    isPro: isProPlan(plan),
    isPaid: isPaidPlan(plan),
    isFree: plan === 'free' || plan === null,
    isTrial: plan === 'trial',
    isTeam: isTeamPlan(plan),
    isBusiness: isBusinessPlan(plan),
    isLoading: team.isLoading && me.isLoading && !jwtPlan,
  }
}

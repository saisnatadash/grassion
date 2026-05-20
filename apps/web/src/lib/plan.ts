import { useQuery } from '@tanstack/react-query'
import type { Plan } from '@grassion/shared'
import { api } from './api.js'
import { decodePlanFromToken } from './utils.js'

export function isPaidPlan(plan: Plan | string | null | undefined): boolean {
  if (!plan) return false
  // Any plan except 'trial' is considered paid — covers 'starter', 'team',
  // 'business', and any custom value set directly in the DB (e.g. 'pro').
  return plan !== 'trial'
}

// 'starter' is the base paid plan — MVP gives it full access.
// 'pro' and 'admin' are custom DB values that also map to highest tier.
const TEAM_PLANS = ['starter', 'team', 'business', 'pro', 'admin']
const BUSINESS_PLANS = ['starter', 'team', 'business', 'pro', 'admin']

export function isTeamPlan(plan: Plan | string | null | undefined): boolean {
  if (!plan) return false
  return TEAM_PLANS.includes(plan)
}

export function isBusinessPlan(plan: Plan | string | null | undefined): boolean {
  if (!plan) return false
  return BUSINESS_PLANS.includes(plan)
}

export interface UsePlanResult {
  plan: Plan | null
  isPaid: boolean
  isTrial: boolean
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
    isPaid: isPaidPlan(plan),
    isTrial: plan === 'trial' || plan === null,
    isTeam: isTeamPlan(plan),
    isBusiness: isBusinessPlan(plan),
    isLoading: team.isLoading && me.isLoading && !jwtPlan,
  }
}

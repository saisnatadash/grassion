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

const TEAM_PLANS = ['team', 'business']
const BUSINESS_PLANS = ['business']

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
 * Returns the current user's plan.
 * - Reads the JWT immediately (synchronous) so there's no loading flash.
 * - Also fetches /api/team so the UI updates if the plan changes after a payment.
 * - The API value takes precedence over the JWT when both are available.
 */
export function usePlan(): UsePlanResult {
  const jwtPlan = decodePlanFromToken()
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.get })
  const plan = (team.data?.plan ?? jwtPlan) as Plan | null

  return {
    plan,
    isPaid: isPaidPlan(plan),
    isTrial: plan === 'trial' || plan === null,
    isTeam: isTeamPlan(plan),
    isBusiness: isBusinessPlan(plan),
    isLoading: team.isLoading && !jwtPlan,
  }
}

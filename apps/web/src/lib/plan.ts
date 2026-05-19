import { useQuery } from '@tanstack/react-query'
import type { Plan } from '@grassion/shared'
import { api } from './api.js'
import { decodePlanFromToken } from './utils.js'

const PAID_PLANS: Plan[] = ['starter', 'team', 'business']

export function isPaidPlan(plan: Plan | null | undefined): boolean {
  if (!plan) return false
  return PAID_PLANS.includes(plan)
}

export interface UsePlanResult {
  plan: Plan | null
  isPaid: boolean
  isTrial: boolean
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
    isLoading: team.isLoading && !jwtPlan,
  }
}

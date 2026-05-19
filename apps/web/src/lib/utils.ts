import clsx, { type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Plan } from '@grassion/shared'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatUsd(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(Math.round(n))
  return `${sign}$${abs.toLocaleString('en-US')}`
}

/**
 * Decodes the plan field embedded in the Grassion JWT without verifying the signature.
 * Safe for UI gating only — the server re-validates on every request.
 */
export function decodePlanFromToken(): Plan | null {
  try {
    const token = localStorage.getItem('grassion_token')
    if (!token) return null
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const padded = parts[1]!.replace(/-/g, '+').replace(/_/g, '/') + '=='
    const payload = JSON.parse(atob(padded)) as { plan?: string }
    return (payload.plan ?? null) as Plan | null
  } catch {
    return null
  }
}

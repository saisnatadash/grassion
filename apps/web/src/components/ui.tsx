import { type ButtonHTMLAttributes, type HTMLAttributes, forwardRef } from 'react'
import { cn } from '../lib/utils.js'

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-neutral-200 bg-white shadow-sm', className)}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-6 pt-6', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-base font-semibold tracking-tight', className)} {...props} />
  ),
)
CardTitle.displayName = 'CardTitle'

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6', className)} {...props} />
  ),
)
CardContent.displayName = 'CardContent'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none'
    const variants: Record<string, string> = {
      primary: 'bg-neutral-900 text-white hover:bg-neutral-800',
      secondary: 'bg-white text-neutral-900 border border-neutral-200 hover:bg-neutral-50',
      ghost: 'bg-transparent text-neutral-900 hover:bg-neutral-100',
      destructive: 'bg-red-600 text-white hover:bg-red-700',
    }
    const sizes: Record<string, string> = {
      sm: 'h-8 px-3 text-sm',
      md: 'h-10 px-4 text-sm',
      lg: 'h-12 px-6 text-base',
    }
    return <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} {...props} />
  },
)
Button.displayName = 'Button'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'green' | 'red' | 'yellow' | 'gray' | 'blue'
}

export function Badge({ className, tone = 'gray', ...props }: BadgeProps) {
  const tones: Record<string, string> = {
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    gray: 'bg-neutral-100 text-neutral-800',
    blue: 'bg-blue-100 text-blue-800',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}

export function Alert({
  tone = 'blue',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: 'blue' | 'yellow' | 'red' | 'green' }) {
  const tones: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    yellow: 'border-yellow-200 bg-yellow-50 text-yellow-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    green: 'border-green-200 bg-green-50 text-green-900',
  }
  return <div className={cn('rounded-md border px-4 py-3 text-sm', tones[tone], className)} {...props} />
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin h-5 w-5 text-neutral-500', className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

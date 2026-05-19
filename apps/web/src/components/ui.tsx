import { type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '../lib/utils.js'

/* ── CARD ────────────────────────────────────────── */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-xl border border-[#222222] bg-[#111111]', className)}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-6 pt-5 pb-4', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-sm font-semibold uppercase tracking-widest text-[#888888]', className)}
      {...props}
    />
  ),
)
CardTitle.displayName = 'CardTitle'

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-6 pb-6', className)} {...props} />
  ),
)
CardContent.displayName = 'CardContent'

/* ── BUTTON ──────────────────────────────────────── */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center rounded-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-2 focus:ring-offset-[#0a0a0a] disabled:opacity-40 disabled:pointer-events-none'
    const variants: Record<string, string> = {
      primary: 'bg-white text-black hover:bg-[#e5e5e5] active:bg-[#d0d0d0]',
      secondary: 'bg-transparent text-white border border-[#333333] hover:bg-[#1a1a1a] hover:border-[#444444]',
      ghost: 'bg-transparent text-[#888888] hover:bg-[#1a1a1a] hover:text-white',
      destructive: 'bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20',
    }
    const sizes: Record<string, string> = {
      sm: 'h-8 px-3 text-xs gap-1.5',
      md: 'h-9 px-4 text-sm gap-2',
      lg: 'h-11 px-6 text-sm gap-2',
    }
    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

/* ── BADGE ───────────────────────────────────────── */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'green' | 'red' | 'yellow' | 'gray' | 'blue'
}

export function Badge({ className, tone = 'gray', ...props }: BadgeProps) {
  const tones: Record<string, string> = {
    green: 'bg-green-500/10 text-green-500 border border-green-500/20',
    red: 'bg-red-500/10 text-red-500 border border-red-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    gray: 'bg-white/5 text-[#888888] border border-[#333333]',
    blue: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
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

/* ── ALERT ───────────────────────────────────────── */
export function Alert({
  tone = 'blue',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: 'blue' | 'yellow' | 'red' | 'green' }) {
  const tones: Record<string, string> = {
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    yellow: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
    red: 'border-red-500/30 bg-red-500/10 text-red-300',
    green: 'border-green-500/30 bg-green-500/10 text-green-300',
  }
  return (
    <div
      className={cn('rounded-lg border px-4 py-3 text-sm leading-relaxed', tones[tone], className)}
      {...props}
    />
  )
}

/* ── SPINNER ─────────────────────────────────────── */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin h-5 w-5 text-[#888888]', className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/* ── INPUT ───────────────────────────────────────── */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'block w-full rounded-lg border border-[#222222] bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder-[#555555] transition-colors focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/10',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

/* ── TOGGLE ──────────────────────────────────────── */
export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        {description && <div className="text-xs text-[#888888] mt-0.5">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-2 focus:ring-offset-[#0a0a0a]',
          checked ? 'bg-white' : 'bg-[#333333]',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-4 w-4 rounded-full shadow-sm transition-transform',
            checked ? 'bg-[#0a0a0a] translate-x-4' : 'bg-white translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

/* ── STAT CARD ───────────────────────────────────── */
export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'green' | 'red' | 'yellow' | 'white'
}) {
  const valueColor =
    tone === 'green'
      ? 'text-green-500'
      : tone === 'red'
        ? 'text-red-500'
        : tone === 'yellow'
          ? 'text-yellow-400'
          : 'text-white'

  return (
    <Card>
      <CardContent className="px-5 py-5">
        <div className="text-xs font-medium uppercase tracking-widest text-[#888888]">{label}</div>
        <div className={cn('mt-2 text-3xl font-semibold tabular-nums', valueColor)}>{value}</div>
        {sub && <div className="mt-1 text-xs text-[#555555]">{sub}</div>}
      </CardContent>
    </Card>
  )
}

/* ── SECTION HEADING ─────────────────────────────── */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-widest text-[#888888] mb-3">
      {children}
    </h2>
  )
}

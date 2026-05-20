import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Menu, X, BarChart2, DollarSign, Settings, LogOut, CreditCard } from 'lucide-react'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'

export function AppLayout() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [])

  if (me.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#333] border-t-white" />
          <span className="text-sm text-[#555]">Loading…</span>
        </div>
      </div>
    )
  }
  if (me.isError || !me.data) {
    window.location.href = 'https://grassion.com'
    return null
  }

  const user = me.data.user
  const team = me.data.team

  async function signOut() {
    await api.logout()
    qc.clear()
    localStorage.removeItem('grassion_token')
    localStorage.removeItem('grassion_onboarded')
    window.location.href = 'https://grassion.com'
  }

  const navLinks = [
    { to: '/dashboard', label: 'Dashboard', icon: BarChart2 },
    { to: '/seat-waste', label: 'Seat Waste', icon: DollarSign },
    { to: '/billing', label: 'Billing', icon: CreditCard },
    { to: '/settings', label: 'Settings', icon: Settings },
  ]

  const isTrial = team.plan === 'trial'
  const planLabel = isTrial
    ? '14-day trial'
    : `${team.plan.charAt(0).toUpperCase() + team.plan.slice(1)}`

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* ── NAVBAR ── */}
      <header className="sticky top-0 z-50 border-b border-[#222222] bg-[#111111]">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">

          {/* Left: Logo — always visible wordmark */}
          <Link
            to="/dashboard"
            className="flex items-center gap-2.5 select-none flex-shrink-0"
          >
            <img
              src="/grassion-logo-white.svg"
              alt=""
              style={{ height: '24px', width: '24px' }}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
            <span className="text-white font-semibold text-base tracking-tight">
              Grassion
            </span>
          </Link>

          {/* Center: Nav links (desktop) */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-white/8 text-white'
                      : 'text-[#888888] hover:bg-white/5 hover:text-white',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Right: Plan badge + Profile */}
          <div className="flex items-center gap-2">
            {/* Plan badge */}
            <span
              className={cn(
                'hidden sm:inline-flex rounded-md px-2.5 py-1 text-xs font-medium',
                isTrial
                  ? 'text-yellow-400 bg-yellow-500/10 border border-yellow-500/20'
                  : 'text-white bg-white/10 border border-white/20',
              )}
            >
              {planLabel}
            </span>

            {/* Profile dropdown */}
            <div className="relative" ref={dropRef}>
              <button
                onClick={() => setDropdownOpen((o) => !o)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-white/5"
              >
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full border border-[#333]" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-[#222] border border-[#333] flex items-center justify-center text-xs font-semibold text-white">
                    {user.githubLogin[0]?.toUpperCase()}
                  </div>
                )}
                <span className="hidden sm:block text-[#888888] text-sm font-medium">
                  {user.githubLogin}
                </span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-[#555] transition-transform', dropdownOpen && 'rotate-180')} />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-[#222222] bg-[#111111] py-1 shadow-xl shadow-black/50">
                  <div className="px-3 py-2.5 border-b border-[#222222]">
                    <div className="text-xs font-semibold text-white">@{user.githubLogin}</div>
                    <div className="text-xs text-[#555555] mt-0.5">{team.name}</div>
                    <div className={cn(
                      'mt-1.5 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                      isTrial ? 'bg-yellow-500/15 text-yellow-400' : 'bg-white/10 text-white',
                    )}>
                      {planLabel}
                    </div>
                  </div>
                  <DropItem icon={Settings} label="Settings" onClick={() => { navigate('/settings'); setDropdownOpen(false) }} />
                  <DropItem icon={CreditCard} label="Billing" onClick={() => { navigate('/billing'); setDropdownOpen(false) }} />
                  <DropItem icon={LogOut} label="Sign out" onClick={signOut} danger />
                </div>
              )}
            </div>

            {/* Hamburger (mobile) */}
            <button
              className="md:hidden rounded-lg p-1.5 text-[#888888] hover:bg-white/5 hover:text-white"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="md:hidden border-t border-[#222222] bg-[#111111] px-4 pb-4 pt-2">
            {navLinks.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive ? 'bg-white/8 text-white' : 'text-[#888888] hover:text-white',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
            <div className="mt-2 border-t border-[#222222] pt-2">
              <button
                onClick={signOut}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── PAGE CONTENT ── */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}

function DropItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ElementType
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors',
        danger
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-[#888888] hover:bg-white/5 hover:text-white',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

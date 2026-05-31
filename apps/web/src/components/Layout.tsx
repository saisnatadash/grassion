import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  ChevronDown, Menu, X, BarChart2, DollarSign, Settings, LogOut, CreditCard,
  Shield, Activity, GitPullRequest, Bell, CheckCheck, XCircle, Zap,
} from 'lucide-react'
import { api, type NotificationItem } from '../lib/api.js'
import { cn, planDisplayLabel } from '../lib/utils.js'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function NotifTypeIcon({ type }: { type: string }) {
  if (type === 'revert_detected') return <span className="text-red-400">↩</span>
  if (type === 'hotfix_surge') return <span className="text-orange-400">⚡</span>
  return <span className="text-yellow-400">⚠</span>
}

function NotificationPanel({
  notifications,
  onMarkAllRead,
  onMarkRead,
}: {
  notifications: NotificationItem[]
  onMarkAllRead: () => void
  onMarkRead: (id: string) => void
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const unread = notifications.filter((n) => !n.readAt && !dismissed.has(n.id))
  const visible = notifications.filter((n) => !dismissed.has(n.id))

  function dismiss(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    onMarkRead(id)
    setDismissed((prev) => new Set([...prev, id]))
  }

  return (
    <div className="absolute right-0 top-full mt-1.5 w-80 rounded-xl border border-[#222222] bg-[#111111] shadow-xl shadow-black/50 overflow-hidden z-50">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#222222]">
        <span className="text-xs font-semibold text-white">Notifications</span>
        {unread.length > 0 && (
          <button
            onClick={onMarkAllRead}
            className="flex items-center gap-1 text-[10px] text-[#555] hover:text-white transition-colors"
          >
            <CheckCheck className="h-3 w-3" />
            Mark all read
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="py-10 text-center">
          <Bell className="mx-auto h-6 w-6 text-[#333] mb-2" />
          <p className="text-xs text-[#555]">No notifications yet</p>
        </div>
      ) : (
        <ul className="max-h-80 overflow-y-auto">
          {visible.map((n) => (
            <li
              key={n.id}
              className={cn(
                'px-4 py-3 border-b border-[#1a1a1a] last:border-0 cursor-pointer hover:bg-white/3 transition-colors',
                !n.readAt && 'bg-white/2',
              )}
              onClick={() => !n.readAt && onMarkRead(n.id)}
            >
              <div className="flex items-start gap-2.5">
                <span className="text-base mt-0.5 flex-shrink-0">
                  <NotifTypeIcon type={n.type} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn('text-xs font-medium leading-tight', n.readAt ? 'text-[#666]' : 'text-white')}>
                      {n.title}
                    </p>
                    <button
                      onClick={(e) => dismiss(n.id, e)}
                      className="flex-shrink-0 text-[#444] hover:text-[#aaa] transition-colors mt-0.5"
                      title="Dismiss"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-[#555] mt-0.5 leading-relaxed">{n.body}</p>
                  <p className="text-[10px] text-[#444] mt-1">{timeAgo(n.createdAt)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })
  const seatWaste = useQuery({
    queryKey: ['analytics', 'seat-waste'],
    queryFn: api.analytics.seatWaste,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const health = useQuery({
    queryKey: ['analytics', 'health'],
    queryFn: api.analytics.health,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const notifQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications.list,
    staleTime: 30_000,
    retry: false,
  })

  const markRead = useMutation({
    mutationFn: api.notifications.markRead,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const markAllRead = useMutation({
    mutationFn: api.notifications.markAllRead,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const inactiveCount = seatWaste.data?.inactiveUsers.length ?? 0
  const isHighRisk = health.data?.riskLevel === 'high'
  const notifications = notifQuery.data ?? []
  const unreadCount = notifications.filter((n) => !n.readAt).length

  const [spendBadgeSeen, setSpendBadgeSeen] = useState(() =>
    Number(localStorage.getItem('spend_badge_seen') ?? 0),
  )
  useEffect(() => {
    if (location.pathname === '/spend-intelligence') {
      localStorage.setItem('spend_badge_seen', String(inactiveCount))
      setSpendBadgeSeen(inactiveCount)
    }
  }, [location.pathname, inactiveCount])
  const spendBadge = inactiveCount > spendBadgeSeen ? inactiveCount : null

  const [mobileOpen, setMobileOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  // Close dropdowns on outside click
  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropdownOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [])

  // SSE for live notifications
  useEffect(() => {
    if (!me.data) return
    const es = new EventSource(`${API_URL}/api/notifications/stream`, { withCredentials: true })
    es.addEventListener('notification', () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    })
    es.onerror = () => es.close()
    return () => es.close()
  }, [me.data, qc])

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
    if ((me.error as { status?: number } | null)?.status === 401 || !me.data) {
      localStorage.removeItem('grassion_token')
    }
    return <Navigate to="/login" replace />
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
    { to: '/dashboard', label: 'Dashboard', icon: BarChart2, badge: null as number | null },
    { to: '/spend-intelligence', label: 'AI Spend', icon: DollarSign, badge: spendBadge },
    { to: '/health', label: 'Health', icon: Activity, badge: isHighRisk ? 1 : null as number | null },
    { to: '/outcomes', label: 'Outcomes', icon: GitPullRequest, badge: null as number | null },
    { to: '/settings', label: 'Settings', icon: Settings, badge: null as number | null },
  ]

  const isTrial = team.plan === 'trial'
  const planLabel = planDisplayLabel(team.plan)

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* ── NAVBAR ── */}
      <header className="sticky top-0 z-50 border-b border-[#222222] bg-[#111111]">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">

          {/* Left: Logo */}
          <Link to="/dashboard" className="flex items-center gap-2.5 select-none flex-shrink-0">
            <img
              src="/W+L.png"
              alt="Grassion"
              style={{ height: '26px' }}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          </Link>

          {/* Center: Nav links (desktop) */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map(({ to, label, badge }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive ? 'bg-white/8 text-white' : 'text-[#888888] hover:bg-white/5 hover:text-white',
                  )
                }
              >
                <span className="relative">
                  {label}
                  {badge !== null && (
                    <span className="absolute -top-2.5 -right-3.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </span>
              </NavLink>
            ))}
          </nav>

          {/* Right: Notification bell + Plan badge + Profile */}
          <div className="flex items-center gap-2">
            {/* Notification bell */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen((o) => !o)}
                className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[#888] hover:bg-white/5 hover:text-white transition-colors"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-bold text-white leading-none">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <NotificationPanel
                  notifications={notifications}
                  onMarkAllRead={() => markAllRead.mutate()}
                  onMarkRead={(id) => markRead.mutate(id)}
                />
              )}
            </div>

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
                  {/* Upgrade nudge: show for non-Business plans */}
                  {team.plan !== 'business' && team.plan !== 'admin' && (
                    <button
                      onClick={() => { navigate('/billing'); setDropdownOpen(false) }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-green-400 hover:bg-green-500/10 transition-colors"
                    >
                      <Zap className="h-3.5 w-3.5" />
                      {team.plan === 'starter' ? 'Upgrade to Growth' : team.plan === 'team' ? 'Upgrade to Business' : 'Upgrade plan'}
                    </button>
                  )}
                  <DropItem icon={Settings} label="Settings" onClick={() => { navigate('/settings'); setDropdownOpen(false) }} />
                  <DropItem icon={CreditCard} label="Billing" onClick={() => { navigate('/billing'); setDropdownOpen(false) }} />
                  <DropItem icon={Shield} label="Security" onClick={() => { navigate('/security'); setDropdownOpen(false) }} />
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
            {navLinks.map(({ to, label, icon: Icon, badge }) => (
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
                <span className="relative">
                  {label}
                  {badge !== null && (
                    <span className="absolute -top-2.5 -right-3.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </span>
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

import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DollarSign } from 'lucide-react'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui.js'

export function AppLayout() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })

  if (me.isLoading) {
    return <div className="flex min-h-full items-center justify-center text-neutral-500">Loading…</div>
  }
  if (me.isError || !me.data) {
    navigate('/login', { replace: true })
    return null
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/dashboard" className="flex items-center">
              <img src="/grassion-logo-dark.svg" alt="Grassion" style={{ height: '32px' }} />
            </Link>
            <nav className="flex items-center gap-2 text-sm">
              <NavItem to="/dashboard">Dashboard</NavItem>
              <NavItem to="/seat-waste">
                <span className="flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5" />Seat Waste
                </span>
              </NavItem>
              <NavItem to="/settings">Settings</NavItem>
              <NavItem to="/billing">Billing</NavItem>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-600">{me.data.team.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await api.logout()
                qc.clear()
                navigate('/login', { replace: true })
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'rounded-md px-3 py-1.5 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
          isActive && 'bg-neutral-100 text-neutral-900',
        )
      }
    >
      {children}
    </NavLink>
  )
}

import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { Spinner } from '../components/ui.js'

const NAV = [
  { to: '/admin/overview',   label: 'Overview' },
  { to: '/admin/funnel',     label: 'Funnel' },
  { to: '/admin/teams',      label: 'Teams & Users' },
  { to: '/admin/engagement', label: 'Engagement' },
  { to: '/admin/revenue',    label: 'Revenue' },
  { to: '/admin/marketing',  label: 'Marketing' },
  { to: '/admin/forms',      label: 'Forms' },
  { to: '/admin/system',     label: 'System' },
  { to: '/admin/events',     label: 'Events' },
]

export function AdminLayout() {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-me'],
    queryFn: () => api.adminMe(),
    retry: false,
  })

  useEffect(() => {
    if (!isLoading && (isError || !data?.isSuperAdmin)) navigate('/dashboard', { replace: true })
  }, [isLoading, isError, data, navigate])

  if (isLoading) return <div className="flex items-center justify-center min-h-screen"><Spinner /></div>
  if (isError || !data?.isSuperAdmin) return null

  return (
    <div className="flex min-h-screen bg-[#0a0a0a] text-white">
      <aside className="w-48 shrink-0 border-r border-white/10 flex flex-col py-6 px-4 gap-1">
        <div className="text-xs font-mono text-white/40 uppercase tracking-widest mb-4 px-2">Admin</div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm transition-colors ${isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`
            }
          >
            {n.label}
          </NavLink>
        ))}
        <div className="mt-auto border-t border-white/10 pt-4">
          <Link to="/dashboard" className="px-3 py-1.5 text-sm text-white/40 hover:text-white transition-colors block">
            ← App
          </Link>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}

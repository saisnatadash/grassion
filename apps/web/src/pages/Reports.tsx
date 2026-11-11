import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils.js'

const TABS = [
  { to: '/reports/ai-impact', label: 'AI Impact' },
  { to: '/reports/governance', label: 'AI Governance' },
  { to: '/reports/ma', label: 'M&A Report' },
]

export function ReportsLayout() {
  const { pathname } = useLocation()
  const isRoot = pathname === '/reports' || pathname === '/reports/'

  if (isRoot) return <Navigate to="/reports/ai-impact" replace />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Reports</h1>
        <p className="mt-1 text-sm text-[#888888]">AI impact analysis, governance metrics, and knowledge continuity reports.</p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-[#222]">
        {TABS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-white text-white'
                  : 'border-transparent text-[#666] hover:text-[#aaa]',
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  )
}

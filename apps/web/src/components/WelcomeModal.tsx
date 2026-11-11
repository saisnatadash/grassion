import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Eye, BarChart2, AlertTriangle, GitBranch } from 'lucide-react'
import { api } from '../lib/api.js'
import { useInstallPopup } from '../lib/install-popup.js'

const STORAGE_KEY = 'grassion_welcomed_v1'

export function WelcomeModal() {
  const [open, setOpen] = useState(false)
  const { open: openInstall } = useInstallPopup()
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.repos.list, retry: false })

  useEffect(() => {
    if (repos.isLoading) return
    const seen = localStorage.getItem(STORAGE_KEY)
    const hasRepos = (repos.data?.length ?? 0) > 0
    if (!seen && !hasRepos) setOpen(true)
  }, [repos.isLoading, repos.data])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1')
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70">
      <div className="relative w-full max-w-sm rounded-2xl border border-[#2a2a2a] bg-[#111] p-6 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
        <button
          onClick={dismiss}
          className="absolute right-4 top-4 text-[#555] hover:text-white transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-5">
          <p className="text-xs font-medium text-[#555] uppercase tracking-wider mb-1">Welcome to Grassion</p>
          <h2 className="text-xl font-semibold text-white leading-tight">
            Know who understands your code
          </h2>
        </div>

        <div className="space-y-3 mb-6">
          <Feature
            icon={<Eye className="h-4 w-4" />}
            title="Dark Code detection"
            desc="See which files only one person — or nobody — understands"
          />
          <Feature
            icon={<BarChart2 className="h-4 w-4" />}
            title="AI ROI tracking"
            desc="Measure whether GitHub Copilot or Cursor is actually paying off"
          />
          <Feature
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Offboarding risk"
            desc="Know your bus-factor risk before someone leaves the team"
          />
          <Feature
            icon={<GitBranch className="h-4 w-4" />}
            title="Human Coverage"
            desc="PR-level coverage scores — posted as a GitHub check on every PR"
          />
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => { dismiss(); openInstall() }}
            className="w-full rounded-lg bg-white py-2.5 text-sm font-semibold text-black hover:bg-gray-100 transition-colors"
          >
            Connect your first repo →
          </button>
          <button
            onClick={dismiss}
            className="text-xs text-[#555] hover:text-[#888] py-1 transition-colors"
          >
            I'll do this later
          </button>
        </div>
      </div>
    </div>
  )
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex-shrink-0 text-[#555]">{icon}</span>
      <div>
        <span className="text-sm font-medium text-[#ccc]">{title}</span>
        <span className="text-sm text-[#666]"> — {desc}</span>
      </div>
    </div>
  )
}

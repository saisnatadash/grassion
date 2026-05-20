import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, ChevronRight } from 'lucide-react'
import { api } from '../lib/api.js'
import { Button, Spinner } from './ui.js'
import { cn } from '../lib/utils.js'

const AI_TOOLS = [
  { id: 'github_copilot', label: 'GitHub Copilot' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude_code', label: 'Claude Code' },
  { id: 'codeium', label: 'Codeium / Windsurf' },
  { id: 'tabnine', label: 'Tabnine' },
  { id: 'other', label: 'Other' },
]

const TEAM_SIZES = [
  { label: '1–5', value: 3 },
  { label: '6–15', value: 10 },
  { label: '16–50', value: 30 },
  { label: '50+', value: 75 },
]

interface OnboardingModalProps {
  onClose: () => void
}

export function OnboardingModal({ onClose }: OnboardingModalProps) {
  const qc = useQueryClient()
  const [step, setStep] = useState(0)
  const [teamSize, setTeamSize] = useState<number | null>(null)
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [monthlySpend, setMonthlySpend] = useState('')
  const [hourlyRate, setHourlyRate] = useState('75')
  const [saving, setSaving] = useState(false)

  function toggleTool(id: string) {
    setSelectedTools((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    )
  }

  async function finish() {
    setSaving(true)
    try {
      const spend = parseFloat(monthlySpend) || 0
      const rate = parseFloat(hourlyRate) || 75
      await api.team.update({
        monthlyAiSpendUsd: spend,
        avgDevHourlyRateUsd: rate,
      })
      await qc.invalidateQueries({ queryKey: ['team'] })
    } catch {
      // best-effort — don't block the user
    } finally {
      setSaving(false)
      localStorage.setItem('grassion_onboarded', '1')
      onClose()
    }
  }

  function skip() {
    localStorage.setItem('grassion_onboarded', '1')
    onClose()
  }

  const steps = [
    /* Step 0 — team size */
    <div key="size">
      <h2 className="text-lg font-semibold text-white mb-1">How big is your engineering team?</h2>
      <p className="text-sm text-[#888888] mb-6">Helps us calibrate your ROI estimate.</p>
      <div className="grid grid-cols-2 gap-3">
        {TEAM_SIZES.map(({ label, value }) => (
          <button
            key={label}
            onClick={() => { setTeamSize(value); setStep(1) }}
            className={cn(
              'rounded-xl border px-5 py-4 text-left transition-colors',
              teamSize === value
                ? 'border-white/40 bg-white/10 text-white'
                : 'border-[#333] bg-white/2 text-[#888888] hover:border-white/20 hover:text-white',
            )}
          >
            <span className="text-base font-semibold">{label}</span>
            <span className="block text-xs mt-0.5 opacity-60">developers</span>
          </button>
        ))}
      </div>
    </div>,

    /* Step 1 — AI tools */
    <div key="tools">
      <h2 className="text-lg font-semibold text-white mb-1">Which AI coding tools do you use?</h2>
      <p className="text-sm text-[#888888] mb-6">Select all that apply.</p>
      <div className="grid grid-cols-2 gap-2">
        {AI_TOOLS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => toggleTool(id)}
            className={cn(
              'rounded-xl border px-4 py-3 text-left text-sm transition-colors',
              selectedTools.includes(id)
                ? 'border-white/40 bg-white/10 text-white'
                : 'border-[#333] bg-white/2 text-[#888888] hover:border-white/20 hover:text-white',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <Button onClick={() => setStep(2)} disabled={selectedTools.length === 0}>
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>,

    /* Step 2 — spend + rate */
    <div key="spend">
      <h2 className="text-lg font-semibold text-white mb-1">Your AI spend & team rate</h2>
      <p className="text-sm text-[#888888] mb-6">Used to calculate your actual ROI. You can update this anytime in Settings.</p>
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-[#888888] mb-1.5">Monthly AI tool spend (USD, total)</label>
          <div className="flex items-center gap-2">
            <span className="text-[#888888]">$</span>
            <input
              type="number"
              min={0}
              placeholder="e.g. 200"
              value={monthlySpend}
              onChange={(e) => setMonthlySpend(e.target.value)}
              className="w-full rounded-lg border border-[#333] bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder-[#444] focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/10"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-[#888888] mb-1.5">Average developer hourly rate (USD)</label>
          <div className="flex items-center gap-2">
            <span className="text-[#888888]">$</span>
            <input
              type="number"
              min={1}
              placeholder="75"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              className="w-full rounded-lg border border-[#333] bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder-[#444] focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/10"
            />
          </div>
        </div>
      </div>
      <div className="mt-6 flex items-center justify-between">
        <button onClick={skip} className="text-xs text-[#555555] hover:text-[#888888] transition-colors">
          Skip for now
        </button>
        <Button onClick={finish} disabled={saving}>
          {saving ? <Spinner className="mr-2 h-4 w-4" /> : null}
          {saving ? 'Saving…' : 'Get started'}
        </Button>
      </div>
    </div>,
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl border border-[#222] bg-[#111111] p-6 shadow-2xl">
        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mb-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                'h-1 rounded-full transition-all',
                i === step ? 'w-6 bg-white' : i < step ? 'w-3 bg-white/40' : 'w-3 bg-[#333]',
              )}
            />
          ))}
          <span className="ml-auto text-xs text-[#555555]">{step + 1} / 3</span>
        </div>

        {/* Close */}
        <button
          onClick={skip}
          className="absolute right-4 top-4 text-[#555555] hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {steps[step]}
      </div>
    </div>
  )
}

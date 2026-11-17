import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { installUrl, github, api } from './api.js'

// Opens the GitHub App installation flow in a centred popup.
// After the popup closes:
//  - Calls /api/github/sync to register the installation (bypasses webhook)
//  - Auto-syncs each connected repo so PR data loads immediately
//  - Navigates to the Code Map (/) page so the user sees their data
//  - Keeps polling every 2 s for up to 30 s so late webhook writes are picked up
// Returns { open, syncing } — syncing=true while the post-close work is running.
export function useInstallPopup() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const closeTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [syncing, setSyncing] = useState(false)

  const open = useCallback(() => {
    // Clear stale timers from a previous attempt
    if (closeTimer.current) { clearInterval(closeTimer.current); closeTimer.current = null }
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null }
    setSyncing(false)

    const w = 1024, h = 720
    const left = Math.round(window.screenX + (window.outerWidth - w) / 2)
    const top = Math.round(window.screenY + (window.outerHeight - h) / 2)

    const popup = window.open(
      installUrl(),
      'grassion_install',
      `width=${w},height=${h},left=${left},top=${top},scrollbars=yes,resizable=yes`,
    )

    if (!popup) {
      // Popup blocked — open in new tab, user will refresh manually
      window.open(installUrl(), '_blank', 'noopener,noreferrer')
      return
    }

    popup.focus()

    // Poll until popup closes
    closeTimer.current = setInterval(() => {
      if (!popup.closed) return
      clearInterval(closeTimer.current!)
      closeTimer.current = null

      setSyncing(true)

      // 1. Register the installation (bypass webhook), then auto-trigger PR sync
      //    for every connected repo so data loads without the user having to
      //    manually click Import on Code Map.
      void github.sync()
        .then(async (result) => {
          void qc.invalidateQueries({ queryKey: ['repos'] })
          void qc.invalidateQueries({ queryKey: ['me'] })
          void qc.invalidateQueries({ queryKey: ['team'] })
          void qc.invalidateQueries({ queryKey: ['metrics'] })

          if (result.ok) {
            // Auto-enable all repos and kick off historical PR sync.
            // First-time users should never need to visit Settings just to toggle repos on.
            try {
              const repos = await api.repos.list()
              for (const repo of repos) {
                if (!repo.isActive) {
                  await api.repos.toggle(repo.id, true).catch(() => {})
                }
                await api.repos.sync(repo.id).catch(() => {})
              }
            } catch {
              // If listing fails (e.g. no repos yet), just continue
            }
          }

          // Navigate to the overview so the user sees their data loading
          navigate('/', { replace: false })
        })
        .catch(() => {
          void qc.invalidateQueries({ queryKey: ['repos'] })
        })

      // Keep polling for 30 s to pick up any async webhook writes too
      let attempts = 0
      pollTimer.current = setInterval(() => {
        attempts++
        void qc.invalidateQueries({ queryKey: ['repos'] })
        void qc.invalidateQueries({ queryKey: ['team'] })
        void qc.invalidateQueries({ queryKey: ['metrics'] })
        if (attempts >= 15) {   // 15 × 2 s = 30 s
          clearInterval(pollTimer.current!)
          pollTimer.current = null
          setSyncing(false)
        }
      }, 2000)
    }, 800)
  }, [qc, navigate])

  return { open, syncing }
}

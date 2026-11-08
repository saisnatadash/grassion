import { useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { installUrl } from './api.js'

// Opens the GitHub App installation flow in a small centred popup.
// Polls every 800ms; when the user finishes and the popup closes, we
// invalidate the repos/team queries so the dashboard refreshes automatically.
export function useInstallPopup() {
  const qc = useQueryClient()
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  return useCallback(() => {
    // Clear any stale timer from a previous attempt
    if (timer.current) clearInterval(timer.current)

    const w = 1024, h = 720
    const left = Math.round(window.screenX + (window.outerWidth - w) / 2)
    const top = Math.round(window.screenY + (window.outerHeight - h) / 2)

    const popup = window.open(
      installUrl(),
      'grassion_install',
      `width=${w},height=${h},left=${left},top=${top},scrollbars=yes,resizable=yes`,
    )

    if (!popup) {
      // Blocked by browser — fall back to new tab; user refreshes manually
      window.open(installUrl(), '_blank', 'noopener,noreferrer')
      return
    }

    popup.focus()

    timer.current = setInterval(() => {
      if (!popup.closed) return
      clearInterval(timer.current!)
      timer.current = null
      // Refresh everything that might have changed after installation
      void qc.invalidateQueries({ queryKey: ['repos'] })
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['team'] })
      void qc.invalidateQueries({ queryKey: ['metrics'] })
    }, 800)
  }, [qc])
}

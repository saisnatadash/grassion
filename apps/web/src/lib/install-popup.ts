import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { installUrl, github } from './api.js'

// Opens the GitHub App installation flow in a centred popup.
// After the popup closes:
//  - Invalidates repos/team immediately
//  - Keeps polling every 2 s for up to 30 s so the webhook has time to fire
//    and repos appear without a manual page refresh.
// Returns { open, syncing } — syncing=true while the post-close poll is running.
export function useInstallPopup() {
  const qc = useQueryClient()
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

      // Actively sync repos via API (bypasses webhook) then keep polling to
      // catch repos the webhook may have already written.
      void github.sync().then(() => {
        void qc.invalidateQueries({ queryKey: ['repos'] })
        void qc.invalidateQueries({ queryKey: ['me'] })
        void qc.invalidateQueries({ queryKey: ['team'] })
        void qc.invalidateQueries({ queryKey: ['metrics'] })
      }).catch(() => {
        // sync failed — still invalidate so the UI reflects current DB state
        void qc.invalidateQueries({ queryKey: ['repos'] })
      })

      // Keep polling for 30 s to pick up any async webhook writes too
      let attempts = 0
      pollTimer.current = setInterval(() => {
        attempts++
        void qc.invalidateQueries({ queryKey: ['repos'] })
        void qc.invalidateQueries({ queryKey: ['team'] })
        if (attempts >= 15) {   // 15 × 2 s = 30 s
          clearInterval(pollTimer.current!)
          pollTimer.current = null
          setSyncing(false)
        }
      }, 2000)
    }, 800)
  }, [qc])

  return { open, syncing }
}

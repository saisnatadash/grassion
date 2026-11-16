import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function AuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')

    if (error) {
      navigate('/login?error=' + error, { replace: true })
      return
    }

    // Session cookie is set server-side. Fetch /auth/me to decide where to send
    // the user: first-time users (no GitHub App installed) go to onboarding,
    // returning users go straight to the dashboard.
    fetch('/auth/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        const hasInstall = !!(me as { team?: { githubInstallationId?: number | null } } | null)
          ?.team?.githubInstallationId
        navigate(hasInstall ? '/' : '/onboarding', { replace: true })
      })
      .catch(() => navigate('/', { replace: true }))
  }, [navigate])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0a0a0a',
        color: 'white',
        fontSize: '18px',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      Signing you in…
    </div>
  )
}

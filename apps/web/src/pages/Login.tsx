import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://grassion-api.fly.dev'

function githubUrl(force = false) {
  return `${API_URL}/auth/github${force ? '?force=true' : ''}`
}

export function LoginPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [signedOut, setSignedOut] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    const reason = params.get('reason')

    if (err) {
      setError(reason ?? err)
      return
    }

    if (localStorage.getItem('grassion_token')) {
      navigate('/dashboard', { replace: true })
      return
    }

    if (params.get('signed_out') === '1') {
      setSignedOut(true)
      return
    }

    // No token, no error — go straight to GitHub OAuth.
    window.location.href = githubUrl()
  }, [navigate])

  if (error || signedOut) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: '#0a0a0a',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '380px',
            padding: '48px 36px',
            background: '#111111',
            border: '1px solid #222222',
            borderRadius: '16px',
            textAlign: 'center',
          }}
        >
          <img
            src="/W+L.png"
            alt="Grassion"
            style={{ height: '32px', marginBottom: '28px' }}
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />

          <h1 style={{ color: '#ffffff', fontSize: '20px', fontWeight: 600, margin: '0 0 8px' }}>
            Sign in to Grassion
          </h1>

          {error && (
            <div
              style={{
                background: '#1a0a0a',
                border: '1px solid #441111',
                borderRadius: '8px',
                padding: '12px 16px',
                margin: '20px 0',
                textAlign: 'left',
              }}
            >
              <p style={{ color: '#ef4444', fontSize: '13px', margin: 0 }}>
                {error === 'exception'
                  ? 'Server error during sign-in. Please try again.'
                  : error === 'token_exchange'
                  ? 'GitHub authorization failed. Please try again.'
                  : error === 'team_create'
                  ? 'Account setup failed. Please try again.'
                  : 'Sign-in failed. Please try again.'}
              </p>
            </div>
          )}

          {signedOut && (
            <p style={{ color: '#666', fontSize: '13px', margin: '16px 0 20px' }}>
              You have been signed out.
            </p>
          )}

          <a
            href={githubUrl(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              width: '100%',
              padding: '13px 0',
              background: '#ffffff',
              color: '#0a0a0a',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '15px',
              textDecoration: 'none',
              boxSizing: 'border-box',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
            </svg>
            {error ? 'Try again with GitHub' : 'Continue with GitHub'}
          </a>
        </div>
      </div>
    )
  }

  // Blank screen while redirecting to GitHub (or to dashboard if already signed in)
  return <div style={{ background: '#0a0a0a', minHeight: '100vh' }} />
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export function LoginPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')

    if (err) {
      setError(err)
      return
    }

    if (localStorage.getItem('grassion_token')) {
      navigate('/dashboard', { replace: true })
      return
    }

    // No token, no error — send straight to GitHub OAuth. User never sees this page.
    window.location.href = 'https://grassion-api.fly.dev/auth/github?force_login=true'
  }, [navigate])

  // Only shown when OAuth returns ?error=
  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
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
            maxWidth: '360px',
            padding: '40px 32px',
            background: '#111111',
            border: '1px solid #222222',
            borderRadius: '16px',
            textAlign: 'center',
          }}
        >
          <img
            src="/W+L.png"
            alt="Grassion"
            style={{ height: '32px', marginBottom: '24px' }}
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
          <p style={{ color: '#ef4444', fontSize: '14px', margin: '0 0 24px' }}>
            Sign-in failed. Please try again.
          </p>
          <a
            href="https://grassion-api.fly.dev/auth/github?force_login=true"
            style={{
              display: 'inline-block',
              padding: '12px 28px',
              background: '#ffffff',
              color: '#0a0a0a',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '15px',
              textDecoration: 'none',
            }}
          >
            Try again with GitHub
          </a>
        </div>
      </div>
    )
  }

  // Blank screen while the redirect fires (usually instant)
  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh' }} />
  )
}

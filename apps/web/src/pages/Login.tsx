import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function LoginPage() {
  const navigate = useNavigate()

  useEffect(() => {
    // Already have a token — skip login and go straight to the dashboard.
    // The auth guard in Layout.tsx will verify it and bounce back here only
    // if the session is actually expired (401), at which point it clears the token.
    if (localStorage.getItem('grassion_token')) {
      navigate('/dashboard', { replace: true })
    }
  }, [navigate])

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
        <h1 style={{ color: '#ffffff', fontSize: '20px', fontWeight: 600, margin: '0 0 8px' }}>
          Sign in to Grassion
        </h1>
        <p style={{ color: '#555555', fontSize: '14px', margin: '0 0 28px' }}>
          Measure whether your AI coding spend is paying off.
        </p>

        <a
          href="https://grassion-api.fly.dev/auth/github"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            width: '100%',
            padding: '12px 20px',
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
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
          Continue with GitHub
        </a>

        <p style={{ color: '#444444', fontSize: '12px', margin: '20px 0 0' }}>
          14-day free trial · 5-minute setup
        </p>
      </div>
    </div>
  )
}

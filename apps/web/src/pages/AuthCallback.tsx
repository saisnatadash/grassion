import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function AuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    const error = params.get('error')

    if (error) {
      navigate('/login?error=' + error, { replace: true })
      return
    }

    if (token) {
      localStorage.setItem('grassion_token', token)
      navigate('/dashboard', { replace: true })
      return
    }

    navigate('/login', { replace: true })
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
      Signing you in...
    </div>
  )
}

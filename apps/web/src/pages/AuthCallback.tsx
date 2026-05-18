import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function AuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    // The API set the session cookie before redirecting here.
    // SameSite=None lets subsequent fetch() calls carry it cross-origin.
    // Navigate straight to dashboard — AppLayout will verify the session.
    navigate('/dashboard', { replace: true })
  }, [navigate])

  return (
    <div className="flex min-h-screen items-center justify-center bg-black text-white text-sm">
      Signing you in…
    </div>
  )
}

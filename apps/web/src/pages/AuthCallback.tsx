import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const token = searchParams.get('token')
    if (token) {
      localStorage.setItem('grassion_token', token)
      navigate('/dashboard', { replace: true })
    } else {
      navigate('/login', { replace: true })
    }
  }, [navigate, searchParams])

  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-neutral-600 text-sm">
      Signing you in…
    </div>
  )
}

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Spinner } from '../components/ui.js'

// Landing page for the GitHub App "Setup URL" redirect.
// When opened in the install popup: closes itself so the opener's poll fires sync.
// When opened in a main tab (direct redirect): navigates to the app root.
export default function AuthInstalled() {
  const navigate = useNavigate()

  useEffect(() => {
    if (window.opener && !window.opener.closed) {
      window.close()
    } else {
      navigate('/', { replace: true })
    }
  }, [navigate])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
      <div className="flex flex-col items-center gap-3">
        <Spinner />
        <p className="text-sm text-[#555]">Connecting to Grassion…</p>
      </div>
    </div>
  )
}

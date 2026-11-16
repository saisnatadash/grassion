import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { Spinner } from '../components/ui.js'

const INVITE_KEY = 'grassion_pending_invite'

export default function JoinPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })
  const joinMutation = useMutation({ mutationFn: (t: string) => api.team.join(t) })
  const attempted = useRef(false)
  const [status, setStatus] = useState<'loading' | 'joining' | 'done' | 'error'>('loading')
  const [message, setMessage] = useState('')

  // Store the token in localStorage so it survives the OAuth redirect.
  useEffect(() => {
    if (!token) return
    try { localStorage.setItem(INVITE_KEY, token) } catch { /* private mode */ }
  }, [token])

  useEffect(() => {
    if (me.isLoading) return
    if (attempted.current) return
    attempted.current = true

    if (!me.data) {
      // Not signed in — redirect to GitHub OAuth, then come back.
      window.location.href = `${import.meta.env.VITE_API_URL ?? 'https://grassion-api.fly.dev'}/auth/github`
      return
    }

    // Signed in — attempt to join.
    const pendingToken = (() => {
      try { return localStorage.getItem(INVITE_KEY) } catch { return null }
    })()
    const t = pendingToken ?? token
    if (!t) { setStatus('error'); setMessage('Invalid invite link.'); return }

    setStatus('joining')
    joinMutation.mutate(t, {
      onSuccess: (data) => {
        try { localStorage.removeItem(INVITE_KEY) } catch { /* ignore */ }
        if (data.joined) {
          setMessage(`You've joined ${data.teamName ?? 'the team'}!`)
        } else {
          setMessage("You're already a member of this team.")
        }
        setStatus('done')
        setTimeout(() => navigate('/', { replace: true }), 1500)
      },
      onError: () => {
        setStatus('error')
        setMessage('This invite link is invalid or has expired. Ask your team admin for a new one.')
      },
    })
  }, [me.isLoading, me.data, token, navigate, joinMutation])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
      <div className="flex flex-col items-center gap-4 text-center max-w-sm px-6">
        {(status === 'loading' || status === 'joining') && <Spinner />}
        {status === 'loading' && (
          <p className="text-sm text-[#555]">Verifying invite…</p>
        )}
        {status === 'joining' && (
          <p className="text-sm text-[#555]">Joining team…</p>
        )}
        {status === 'done' && (
          <>
            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-sm text-[#aaa]">{message}</p>
            <p className="text-xs text-[#444]">Redirecting to dashboard…</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-sm text-[#aaa]">{message}</p>
            <button
              className="text-xs text-[#555] underline underline-offset-4"
              onClick={() => navigate('/', { replace: true })}
            >
              Go to dashboard
            </button>
          </>
        )}
      </div>
    </div>
  )
}

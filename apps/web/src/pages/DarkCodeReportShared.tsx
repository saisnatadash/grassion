import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { EyeOff } from 'lucide-react'
import { DarkCodeReportView, type DarkCodeReportData } from './DarkCodeReport.js'
import { Spinner } from '../components/ui.js'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || 'https://grassion-api.fly.dev'

interface SharePayload extends DarkCodeReportData {
  // shareToken is intentionally NOT returned by the API (no need to echo it back).
  expiresAt: string
}

export function DarkCodeReportShared() {
  const { token } = useParams<{ token: string }>()

  const report = useQuery({
    queryKey: ['hc-share', token],
    queryFn: (): Promise<SharePayload> =>
      fetch(`${API_URL}/api/hc/share/${token ?? ''}`)
        .then((r) => {
          if (!r.ok) throw Object.assign(new Error(`${r.status}`), { status: r.status })
          return r.json() as Promise<SharePayload>
        }),
    enabled: !!token,
    retry: false,
  })

  if (report.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
        <Spinner />
      </div>
    )
  }

  if (report.isError || !report.data) {
    const is404 = (report.error as { status?: number } | null)?.status === 404

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0a] gap-4 text-center px-4">
        <EyeOff className="h-10 w-10 text-[#333]" />
        <p className="text-sm text-[#555]">
          {is404
            ? 'This report link has expired or does not exist.'
            : 'Failed to load the shared report.'}
        </p>
      </div>
    )
  }

  const { expiresAt, ...reportData } = report.data

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="border-b border-[#1a1a1a] bg-[#0d0d0d] px-4 py-2 text-center">
        <span className="text-xs text-[#555]">
          Read-only shared report · expires{' '}
          {new Date(expiresAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
      </div>
      <DarkCodeReportView
        data={reportData as DarkCodeReportData}
        repoId={reportData.repo.id}
        readOnly
      />
    </div>
  )
}

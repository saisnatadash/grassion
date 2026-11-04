import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '../components/ui.js'

type Tab = 'contact' | 'careers'

const CONTACT_STATUSES = ['new', 'replied', 'closed']
const CAREER_STATUSES = ['new', 'reviewing', 'interview', 'rejected', 'hired']

function statusColor(s: string) {
  if (s === 'new') return 'bg-yellow-500/20 text-yellow-300'
  if (s === 'replied' || s === 'reviewing' || s === 'interview') return 'bg-blue-500/20 text-blue-300'
  if (s === 'closed' || s === 'rejected') return 'bg-white/10 text-white/40'
  if (s === 'hired') return 'bg-green-500/20 text-green-300'
  return 'bg-white/10 text-white/50'
}

function ContactTab() {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['admin-contact', status, page],
    queryFn: () => api.adminFormsContact({ status, page }),
  })
  const patch = useMutation({
    mutationFn: (vars: { id: string; status?: string; notes?: string }) => api.adminPatchContact(vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-contact'] }),
  })

  const submissions = (data?.submissions ?? []) as Array<Record<string, unknown>>
  const total = (data?.total ?? 0) as number
  const limit = 50

  if (isLoading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <span className="text-sm text-white/50">Filter:</span>
        {['', ...CONTACT_STATUSES].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1) }}
            className={`px-3 py-1 text-xs rounded transition-colors ${status === s ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white'}`}>
            {s || 'all'}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {submissions.map((sub) => (
          <Card key={String(sub.id)}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{String(sub.name)}</span>
                  <span className="text-white/40 text-sm ml-2">{String(sub.email)}</span>
                  <span className="text-white/30 text-xs ml-2 font-mono">{String(sub.topic)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-mono ${statusColor(String(sub.status))}`}>
                    {String(sub.status)}
                  </span>
                  <span className="text-white/30 text-xs">{new Date(String(sub.createdAt)).toLocaleDateString()}</span>
                </div>
              </div>
              <p className="text-sm text-white/60 line-clamp-2">{String(sub.message)}</p>
              <div className="flex gap-2 items-center">
                <select
                  defaultValue={String(sub.status)}
                  onChange={(e) => patch.mutate({ id: String(sub.id), status: e.target.value })}
                  className="bg-white/5 border border-white/20 rounded px-2 py-1 text-xs text-white"
                >
                  {CONTACT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                  defaultValue={String(sub.notes ?? '')}
                  onBlur={(e) => patch.mutate({ id: String(sub.id), notes: e.target.value })}
                  placeholder="Add notes…"
                  className="flex-1 bg-white/5 border border-white/20 rounded px-2 py-1 text-xs text-white placeholder-white/20"
                />
              </div>
            </CardContent>
          </Card>
        ))}
        {submissions.length === 0 && <div className="text-white/30 text-sm">No submissions</div>}
      </div>
      <div className="flex justify-between text-sm text-white/40">
        <span>{total} total</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>Prev</Button>
          <Button variant="secondary" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * limit >= total}>Next</Button>
        </div>
      </div>
    </div>
  )
}

function CareersTab() {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['admin-careers', status, page],
    queryFn: () => api.adminFormsCareers({ status, page }),
  })
  const patch = useMutation({
    mutationFn: (vars: { id: string; status?: string; notes?: string }) => api.adminPatchCareer(vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-careers'] }),
  })
  const getResume = async (id: string) => {
    const result = await api.adminCareerResumeUrl(id)
    if (result?.url) window.open(result.url, '_blank')
  }

  const apps = (data?.applications ?? []) as Array<Record<string, unknown>>
  const total = (data?.total ?? 0) as number
  const limit = 50

  if (isLoading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <span className="text-sm text-white/50">Pipeline:</span>
        {['', ...CAREER_STATUSES].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1) }}
            className={`px-3 py-1 text-xs rounded transition-colors ${status === s ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white'}`}>
            {s || 'all'}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {apps.map((app) => (
          <Card key={String(app.id)}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{String(app.name)}</span>
                  <span className="text-white/40 text-sm ml-2">{String(app.email)}</span>
                  <span className="text-white/60 text-sm ml-2 font-mono bg-white/10 px-2 py-0.5 rounded">{String(app.role)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-mono ${statusColor(String(app.status))}`}>
                    {String(app.status)}
                  </span>
                  <span className="text-white/30 text-xs">{new Date(String(app.createdAt)).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex gap-3 text-xs text-white/40">
                {!!app.linkedinUrl && <a href={String(app.linkedinUrl)} target="_blank" rel="noreferrer" className="hover:text-white">LinkedIn</a>}
                {!!app.githubUrl && <a href={String(app.githubUrl)} target="_blank" rel="noreferrer" className="hover:text-white">GitHub</a>}
                {!!app.portfolioUrl && <a href={String(app.portfolioUrl)} target="_blank" rel="noreferrer" className="hover:text-white">Portfolio</a>}
                {!!app.hasResume && (
                  <button onClick={() => getResume(String(app.id))} className="hover:text-white text-blue-400">
                    Download resume (10 min link)
                  </button>
                )}
              </div>
              <p className="text-sm text-white/60 line-clamp-2">{String(app.message)}</p>
              <div className="flex gap-2 items-center">
                <select
                  defaultValue={String(app.status)}
                  onChange={(e) => patch.mutate({ id: String(app.id), status: e.target.value })}
                  className="bg-white/5 border border-white/20 rounded px-2 py-1 text-xs text-white"
                >
                  {CAREER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                  defaultValue={String(app.notes ?? '')}
                  onBlur={(e) => patch.mutate({ id: String(app.id), notes: e.target.value })}
                  placeholder="Notes…"
                  className="flex-1 bg-white/5 border border-white/20 rounded px-2 py-1 text-xs text-white placeholder-white/20"
                />
              </div>
            </CardContent>
          </Card>
        ))}
        {apps.length === 0 && <div className="text-white/30 text-sm">No applications</div>}
      </div>
      <div className="flex justify-between text-sm text-white/40">
        <span>{total} total</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>Prev</Button>
          <Button variant="secondary" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * limit >= total}>Next</Button>
        </div>
      </div>
    </div>
  )
}

export function AdminForms() {
  const [tab, setTab] = useState<Tab>('contact')
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Forms</h1>
      <div className="flex gap-1 border-b border-white/10 pb-0">
        {(['contact', 'careers'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize transition-colors border-b-2 -mb-[1px] ${tab === t ? 'border-white text-white' : 'border-transparent text-white/40 hover:text-white'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'contact' ? <ContactTab /> : <CareersTab />}
    </div>
  )
}

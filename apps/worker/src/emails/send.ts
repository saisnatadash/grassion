import { Resend } from 'resend'
import { env } from '../env.js'

let _resend: Resend | undefined

export function resend(): Resend {
  if (!_resend) {
    const key = env().RESEND_API_KEY
    if (!key) throw new Error('RESEND_API_KEY not configured')
    _resend = new Resend(key)
  }
  return _resend
}

export async function sendEmail(params: {
  to: string[]
  subject: string
  text: string
  html?: string
}) {
  if (params.to.length === 0) return { id: null }
  const from = env().EMAIL_FROM
  if (!from) throw new Error('EMAIL_FROM not configured')
  const result = await resend().emails.send({
    from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  })
  if (result.error) throw new Error(result.error.message ?? 'resend error')
  return { id: result.data?.id ?? null }
}

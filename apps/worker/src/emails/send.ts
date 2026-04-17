import { Resend } from 'resend'
import { env } from '../env.js'

let _resend: Resend | undefined

export function resend(): Resend {
  if (!_resend) _resend = new Resend(env().RESEND_API_KEY)
  return _resend
}

export async function sendEmail(params: {
  to: string[]
  subject: string
  text: string
  html?: string
}) {
  if (params.to.length === 0) return { id: null }
  const result = await resend().emails.send({
    from: env().EMAIL_FROM,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  })
  if (result.error) throw new Error(result.error.message ?? 'resend error')
  return { id: result.data?.id ?? null }
}

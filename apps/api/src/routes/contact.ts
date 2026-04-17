import { Router, type Request, type Response } from 'express'
import nodemailer from 'nodemailer'
import rateLimit from 'express-rate-limit'
import { contactSchema } from '@grassion/shared'
import { env } from '../env.js'
import { logger } from '../logger.js'

let _transporter: nodemailer.Transporter | undefined

function transporter(): nodemailer.Transporter {
  if (!_transporter) {
    const e = env()
    _transporter = nodemailer.createTransport({
      host: e.ZOHO_SMTP_HOST,
      port: e.ZOHO_SMTP_PORT,
      // Zoho's submission port 587 is STARTTLS, not implicit TLS.
      secure: e.ZOHO_SMTP_PORT === 465,
      auth: { user: e.ZOHO_SMTP_USER, pass: e.ZOHO_SMTP_PASS },
    })
  }
  return _transporter
}

export const contactRouter = Router()

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
})

contactRouter.post('/api/contact', contactLimiter, async (req: Request, res: Response) => {
  const parsed = contactSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', issues: parsed.error.flatten().fieldErrors })
    return
  }
  // Honeypot — silently accept and discard.
  if (parsed.data.website && parsed.data.website.length > 0) {
    res.json({ ok: true })
    return
  }

  const { name, email, message, topic } = parsed.data
  const e = env()

  try {
    await transporter().sendMail({
      from: e.ZOHO_FROM_ADDRESS,
      to: e.ZOHO_TO_ADDRESS,
      replyTo: email,
      subject: `[Grassion Contact] ${topic} — ${name}`,
      text: `From: ${name} <${email}>\nTopic: ${topic}\n\n${message}`,
    })

    await transporter().sendMail({
      from: e.ZOHO_FROM_ADDRESS,
      to: email,
      subject: 'Thanks for reaching out to Grassion',
      text: autoReplyText(name),
    })
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'contact form delivery failed')
    res.status(502).json({ error: 'delivery_failed' })
  }
})

function autoReplyText(name: string): string {
  return `Hi ${name},

Thanks for writing to Grassion. I got your message and I'll get back to you within 24 hours, usually sooner.

If it's urgent, reply to this email directly and it'll reach me faster.

— Mukti
Founder, Grassion
https://grassion.com
`
}

import crypto from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import rateLimit from 'express-rate-limit'
import nodemailer from 'nodemailer'
import { z } from 'zod'
import { careerApplications } from '@grassion/db'
import { db } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { verifyTurnstile } from '../lib/turnstile.js'

// PDF magic bytes: %PDF (0x25 0x50 0x44 0x46)
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46])

export const careersRouter = Router()

const careersLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(new Error('Only PDF files are accepted'))
    }
  },
})

const careerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  role: z.string().min(1).max(120),
  linkedin_url: z.string().url().max(500).optional().or(z.literal('')),
  github_url: z.string().url().max(500).optional().or(z.literal('')),
  portfolio_url: z.string().url().max(500).optional().or(z.literal('')),
  message: z.string().min(10).max(5000),
})

async function uploadResumeToSupabase(
  fileBuffer: Buffer,
): Promise<string | null> {
  const e = env()
  if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_KEY) {
    logger.warn('SUPABASE_URL/SERVICE_KEY not set — resume not stored')
    return null
  }
  // Random filename — never expose the applicant's original filename.
  const randomName = `${crypto.randomBytes(16).toString('hex')}.pdf`
  const path = `applications/${randomName}`
  const url = `${e.SUPABASE_URL}/storage/v1/object/career-resumes/${path}`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${e.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/pdf',
      'x-upsert': 'false',
    },
    body: new Uint8Array(fileBuffer),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Supabase upload failed (${response.status}): ${text}`)
  }
  return path
}

function getTransporter() {
  const e = env()
  return nodemailer.createTransport({
    host: e.ZOHO_SMTP_HOST,
    port: e.ZOHO_SMTP_PORT,
    secure: e.ZOHO_SMTP_PORT === 465,
    auth: { user: e.ZOHO_SMTP_USER, pass: e.ZOHO_SMTP_PASS },
  })
}

careersRouter.post(
  '/api/careers',
  careersLimiter,
  verifyTurnstile,
  upload.single('resume'),
  async (req: Request, res: Response) => {
    const parsed = careerSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input', issues: parsed.error.flatten().fieldErrors })
      return
    }

    const { name, email, role, linkedin_url, github_url, portfolio_url, message } = parsed.data
    let resumePath: string | null = null

    const multerReq = req as Request & { file?: Express.Multer.File }
    if (multerReq.file) {
      // Verify PDF magic bytes — multer's mimetype check can be bypassed by renaming a file.
      if (!multerReq.file.buffer.subarray(0, 4).equals(PDF_MAGIC)) {
        res.status(400).json({ error: 'invalid_file_type', message: 'Only PDF files are accepted.' })
        return
      }
      try {
        resumePath = await uploadResumeToSupabase(multerReq.file.buffer)
      } catch (err) {
        logger.error({ err }, 'resume upload to Supabase failed — continuing without resume')
      }
    }

    const [row] = await db
      .insert(careerApplications)
      .values({
        name,
        email,
        role,
        linkedinUrl: linkedin_url || null,
        githubUrl: github_url || null,
        portfolioUrl: portfolio_url || null,
        message,
        resumePath,
      })
      .returning({ id: careerApplications.id })

    // Email notification to founder
    const e = env()
    if (e.ZOHO_SMTP_USER && e.ZOHO_SMTP_PASS) {
      getTransporter()
        .sendMail({
          from: e.ZOHO_FROM_ADDRESS ?? e.ZOHO_TO_ADDRESS,
          to: e.ZOHO_TO_ADDRESS,
          replyTo: email,
          subject: `[Grassion Career] New application — ${role} — ${name}`,
          text: [
            `Name:      ${name}`,
            `Email:     ${email}`,
            `Role:      ${role}`,
            `LinkedIn:  ${linkedin_url || '—'}`,
            `GitHub:    ${github_url || '—'}`,
            `Portfolio: ${portfolio_url || '—'}`,
            `Resume:    ${resumePath ? `stored at ${resumePath}` : 'not provided'}`,
            ``,
            `Message:`,
            message,
            ``,
            `Admin: ${e.APP_URL}/admin/forms`,
          ].join('\n'),
        })
        .catch((err) => logger.error({ err }, 'career application notification email failed'))
    }

    logger.info({ id: row?.id, role }, 'career application received')
    res.json({ ok: true })
  },
)

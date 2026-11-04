import crypto from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { eq, and } from 'drizzle-orm'
import { mcpApiTokens, teams } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole, isProOrAbove } from '../auth.js'
import { logger } from '../logger.js'

export const mcpTokensRouter = Router()

const mcpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
})

// GET /api/mcp-tokens — list tokens for the team (name, createdAt, lastUsedAt, expiresAt; never the hash)
mcpTokensRouter.get('/api/mcp-tokens', mcpLimiter, requireAuth, async (req: Request, res: Response) => {
  const orgId = req.session!.teamId
  const rows = await db
    .select({ id: mcpApiTokens.id, name: mcpApiTokens.name, createdBy: mcpApiTokens.createdBy, createdAt: mcpApiTokens.createdAt, lastUsedAt: mcpApiTokens.lastUsedAt, expiresAt: mcpApiTokens.expiresAt })
    .from(mcpApiTokens)
    .where(eq(mcpApiTokens.orgId, orgId))
    .orderBy(mcpApiTokens.createdAt)
  const now = new Date()
  res.json(rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    isExpired: r.expiresAt !== null && r.expiresAt <= now,
  })))
})

// POST /api/mcp-tokens — create a new token (Pro+, owner/admin only)
mcpTokensRouter.post(
  '/api/mcp-tokens',
  mcpLimiter,
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    const [teamRow] = await db.select({ plan: teams.plan }).from(teams).where(eq(teams.id, sess.teamId)).limit(1)
    if (!isProOrAbove(teamRow?.plan ?? '')) {
      res.status(403).json({ error: 'pro_required' })
      return
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : ''
    if (!name) {
      res.status(400).json({ error: 'name_required' })
      return
    }

    // Optional expiry: expiresInDays must be 1–365 if provided.
    const expiresInDays = req.body?.expiresInDays
    let expiresAt: Date | null = null
    if (expiresInDays !== undefined && expiresInDays !== null) {
      const days = Number(expiresInDays)
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        res.status(400).json({ error: 'invalid_expiry', message: 'expiresInDays must be 1–365' })
        return
      }
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    }

    const existing = await db
      .select({ id: mcpApiTokens.id })
      .from(mcpApiTokens)
      .where(eq(mcpApiTokens.orgId, sess.teamId))
    if (existing.length >= 10) {
      res.status(400).json({ error: 'token_limit_reached', limit: 10 })
      return
    }

    // Generate a cryptographically secure random token; store only its hash.
    const rawToken = `gmc_${crypto.randomBytes(32).toString('base64url')}`
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    const [row] = await db
      .insert(mcpApiTokens)
      .values({ orgId: sess.teamId, tokenHash, name, createdBy: sess.githubLogin ?? sess.userId, expiresAt })
      .returning({ id: mcpApiTokens.id, createdAt: mcpApiTokens.createdAt })

    logger.info({ orgId: sess.teamId, tokenId: row?.id, expiresAt }, 'mcp token created')
    // Return the raw token ONCE — it cannot be retrieved again.
    res.status(201).json({ id: row?.id, name, token: rawToken, createdAt: row?.createdAt.toISOString(), expiresAt: expiresAt?.toISOString() ?? null })
  },
)

// DELETE /api/mcp-tokens/:id — revoke a token
mcpTokensRouter.delete(
  '/api/mcp-tokens/:id',
  mcpLimiter,
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    const orgId = req.session!.teamId
    const deleted = await db
      .delete(mcpApiTokens)
      .where(and(eq(mcpApiTokens.id, id), eq(mcpApiTokens.orgId, orgId)))
      .returning({ id: mcpApiTokens.id })
    if (deleted.length === 0) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    res.json({ ok: true })
  },
)

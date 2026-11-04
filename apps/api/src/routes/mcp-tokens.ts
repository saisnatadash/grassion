import crypto from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { eq, and } from 'drizzle-orm'
import { mcpApiTokens, teams } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole, isProOrAbove } from '../auth.js'
import { logger } from '../logger.js'

export const mcpTokensRouter = Router()

// GET /api/mcp-tokens — list tokens for the team (name, createdAt, lastUsedAt; never the hash)
mcpTokensRouter.get('/api/mcp-tokens', requireAuth, async (req: Request, res: Response) => {
  const orgId = req.session!.teamId
  const rows = await db
    .select({ id: mcpApiTokens.id, name: mcpApiTokens.name, createdBy: mcpApiTokens.createdBy, createdAt: mcpApiTokens.createdAt, lastUsedAt: mcpApiTokens.lastUsedAt })
    .from(mcpApiTokens)
    .where(eq(mcpApiTokens.orgId, orgId))
    .orderBy(mcpApiTokens.createdAt)
  res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null })))
})

// POST /api/mcp-tokens — create a new token (Pro+, owner/admin only)
mcpTokensRouter.post(
  '/api/mcp-tokens',
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
      .values({ orgId: sess.teamId, tokenHash, name, createdBy: sess.githubLogin ?? sess.userId })
      .returning({ id: mcpApiTokens.id, createdAt: mcpApiTokens.createdAt })

    logger.info({ orgId: sess.teamId, tokenId: row?.id }, 'mcp token created')
    // Return the raw token ONCE — it cannot be retrieved again.
    res.status(201).json({ id: row?.id, name, token: rawToken, createdAt: row?.createdAt.toISOString() })
  },
)

// DELETE /api/mcp-tokens/:id — revoke a token
mcpTokensRouter.delete(
  '/api/mcp-tokens/:id',
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

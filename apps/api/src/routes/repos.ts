import { Router, type Request, type Response } from 'express'
import { eq, and } from 'drizzle-orm'
import { repos } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import { repoToggleSchema } from '@grassion/shared'

export const reposRouter = Router()

reposRouter.get('/api/repos', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const list = await db.select().from(repos).where(eq(repos.teamId, sess.teamId))
  res.json(
    list.map((r) => ({
      id: r.id,
      owner: r.owner,
      name: r.name,
      defaultBranch: r.defaultBranch,
      isActive: r.isActive,
      connectedAt: r.connectedAt.toISOString(),
      lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    })),
  )
})

reposRouter.post(
  '/api/repos/:id/toggle',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    const parsed = repoToggleSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input' })
      return
    }
    const id = req.params.id
    if (!id) {
      res.status(400).json({ error: 'missing_id' })
      return
    }
    await db
      .update(repos)
      .set({ isActive: parsed.data.isActive })
      .where(and(eq(repos.id, id), eq(repos.teamId, sess.teamId)))
    res.json({ ok: true })
  },
)

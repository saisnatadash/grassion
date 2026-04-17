import { Router, type Request, type Response } from 'express'
import { eq, and } from 'drizzle-orm'
import { teams, users } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import { updateTeamSchema } from '@grassion/shared'

export const teamRouter = Router()

teamRouter.get('/api/team', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const row = await db.select().from(teams).where(eq(teams.id, sess.teamId)).limit(1)
  if (!row[0]) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  const t = row[0]
  res.json({
    id: t.id,
    name: t.name,
    slug: t.slug,
    plan: t.plan,
    trialEndsAt: t.trialEndsAt?.toISOString() ?? null,
    githubInstallationId: t.githubInstallationId,
    monthlyAiSpendUsd: t.monthlyAiSpendUsd ?? 0,
    avgDevHourlyRateUsd: t.avgDevHourlyRateUsd ?? 75,
    timezone: t.timezone ?? 'UTC',
    emailDigestEnabled: t.emailDigestEnabled ?? true,
    emailDigestDay: t.emailDigestDay ?? 1,
    emailDigestHour: t.emailDigestHour ?? 9,
  })
})

teamRouter.patch(
  '/api/team',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const parsed = updateTeamSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() })
      return
    }
    const sess = req.session!
    await db
      .update(teams)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(teams.id, sess.teamId))
    res.json({ ok: true })
  },
)

teamRouter.get('/api/team/members', requireAuth, async (req: Request, res: Response) => {
  const sess = req.session!
  const list = await db.select().from(users).where(eq(users.teamId, sess.teamId))
  res.json(
    list.map((u) => ({
      id: u.id,
      githubLogin: u.githubLogin,
      email: u.email,
      avatarUrl: u.avatarUrl,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    })),
  )
})

teamRouter.delete(
  '/api/team/members/:id',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response) => {
    const sess = req.session!
    const id = req.params.id
    if (!id) {
      res.status(400).json({ error: 'missing_id' })
      return
    }
    if (id === sess.userId) {
      res.status(400).json({ error: 'cannot_remove_self' })
      return
    }
    await db.delete(users).where(and(eq(users.id, id), eq(users.teamId, sess.teamId)))
    res.json({ ok: true })
  },
)

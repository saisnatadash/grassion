import { Router, type Request, type Response } from 'express'
import { eq, and, isNull, desc, gt } from 'drizzle-orm'
import { notifications } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { logger } from '../logger.js'

export const notificationsRouter = Router()

notificationsRouter.get('/api/notifications', requireAuth, async (req: Request, res: Response) => {
  const teamId = req.session!.teamId
  try {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.teamId, teamId))
      .orderBy(desc(notifications.createdAt))
      .limit(50)
    res.json(rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt?.toISOString() ?? null,
    })))
  } catch (err) {
    logger.error({ err }, 'notifications list failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

notificationsRouter.post('/api/notifications/:id/read', requireAuth, async (req: Request, res: Response) => {
  const teamId = req.session!.teamId
  const id = req.params['id']
  if (!id) { res.status(400).json({ error: 'missing_id' }); return }
  try {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.teamId, teamId), isNull(notifications.readAt)))
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'notifications mark-read failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

notificationsRouter.post('/api/notifications/read-all', requireAuth, async (req: Request, res: Response) => {
  const teamId = req.session!.teamId
  try {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.teamId, teamId), isNull(notifications.readAt)))
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'notifications read-all failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

notificationsRouter.get('/api/notifications/stream', requireAuth, (req: Request, res: Response) => {
  const teamId = req.session!.teamId

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()
  res.write('event: connected\ndata: {}\n\n')

  let since = new Date()

  const interval = setInterval(async () => {
    try {
      const newRows = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.teamId, teamId), gt(notifications.createdAt, since)))
        .orderBy(desc(notifications.createdAt))
        .limit(10)

      since = new Date()

      for (const row of newRows) {
        const data = JSON.stringify({
          ...row,
          createdAt: row.createdAt.toISOString(),
          readAt: row.readAt?.toISOString() ?? null,
        })
        res.write(`event: notification\ndata: ${data}\n\n`)
      }

      res.write('event: ping\ndata: {}\n\n')
    } catch {
      // swallow DB errors; stream stays alive
    }
  }, 5000)

  req.on('close', () => {
    clearInterval(interval)
    res.end()
  })
})

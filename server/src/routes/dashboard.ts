import { Router, Response } from 'express';
import * as db from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  const result = await db.query(
    `SELECT id, email, name, avatar_url, plan, subscription_status, subscription_end_date, email_verified, created_at
     FROM users WHERE id=$1`,
    [req.user!.id]
  );
  if (!result.rows.length) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(result.rows[0]);
});

router.get('/stats', requireAuth, async (req: AuthRequest, res: Response) => {
  const [prCount, repoCount, notifications] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM pr_events WHERE user_id=$1`, [req.user!.id]),
    db.query(`SELECT COUNT(*) FROM repos WHERE user_id=$1`, [req.user!.id]),
    db.query(`SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND read=false`, [req.user!.id]),
  ]);
  res.json({
    prs: parseInt(prCount.rows[0].count),
    repos: parseInt(repoCount.rows[0].count),
    unread_notifications: parseInt(notifications.rows[0].count),
  });
});

router.get('/notifications', requireAuth, async (req: AuthRequest, res: Response) => {
  const result = await db.query(
    `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [req.user!.id]
  );
  res.json(result.rows);
});

router.patch('/notifications/:id/read', requireAuth, async (req: AuthRequest, res: Response) => {
  await db.query(
    `UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.user!.id]
  );
  res.json({ ok: true });
});

export default router;

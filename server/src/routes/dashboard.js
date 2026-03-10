'use strict';
const { Router } = require('express');
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.get('/me', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT id,email,name,avatar_url,plan,subscription_status,subscription_end_date,email_verified,created_at FROM users WHERE id=$1`,
    [req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(result.rows[0]);
});

router.get('/stats', requireAuth, async (req, res) => {
  const [prCount, repoCount, notifCount] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM pr_events WHERE user_id=$1`, [req.user.id]),
    db.query(`SELECT COUNT(*) FROM repos WHERE user_id=$1`, [req.user.id]),
    db.query(`SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND read=false`, [req.user.id]),
  ]);
  res.json({
    prs: parseInt(prCount.rows[0].count),
    repos: parseInt(repoCount.rows[0].count),
    unread_notifications: parseInt(notifCount.rows[0].count),
  });
});

router.get('/notifications', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [req.user.id]
  );
  res.json(result.rows);
});

router.patch('/notifications/:id/read', requireAuth, async (req, res) => {
  await db.query(`UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;

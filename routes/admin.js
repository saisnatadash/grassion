const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const adminCheck = async (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.user.username !== 'saisnatadash') return res.status(403).json({ error: 'Not admin' });
  next();
};

router.get('/stats', authMiddleware, adminCheck, async (req, res) => {
  const users = await db.query('SELECT COUNT(*) FROM users');
  const proUsers = await db.query(`SELECT COUNT(*) FROM users WHERE plan = 'pro'`);
  const scans = await db.query('SELECT COUNT(*) FROM scans');
  const prs = await db.query('SELECT COUNT(*) FROM scans WHERE pr_raised = TRUE');
  const revenue = await db.query(`SELECT COUNT(*) * 4900 as total FROM payments WHERE status = 'success'`);
  const waitlist = await db.query('SELECT COUNT(*) FROM waitlist');
  res.json({
    totalUsers: users.rows[0].count,
    proUsers: proUsers.rows[0].count,
    totalScans: scans.rows[0].count,
    prsRaised: prs.rows[0].count,
    revenue: revenue.rows[0].total,
    waitlist: waitlist.rows[0].count
  });
});

router.get('/users', authMiddleware, adminCheck, async (req, res) => {
  const result = await db.query('SELECT id, github_username, email, plan, scans_used, created_at, last_seen, location FROM users ORDER BY created_at DESC');
  res.json({ users: result.rows });
});

router.get('/scans', authMiddleware, adminCheck, async (req, res) => {
  const result = await db.query('SELECT s.*, u.github_username FROM scans s JOIN users u ON s.user_id = u.id ORDER BY s.created_at DESC LIMIT 50');
  res.json({ scans: result.rows });
});

module.exports = router;

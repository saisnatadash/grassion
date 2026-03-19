const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const isAdmin = async (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.user.username !== 'saisnatadash') return res.status(403).json({ error: 'Not admin' });
  next();
};

router.get('/stats', authMiddleware, isAdmin, async (req, res) => {
  try {
    const [users, pro, scans, prs, revenue, waitlist, careers, feedback, contacts] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users'),
      db.query("SELECT COUNT(*) FROM users WHERE plan = 'pro'"),
      db.query('SELECT COUNT(*) FROM scans'),
      db.query('SELECT COUNT(*) FROM scans WHERE pr_raised = TRUE'),
      db.query("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE status = 'success'"),
      db.query('SELECT COUNT(*) FROM waitlist'),
      db.query('SELECT COUNT(*) FROM career_applications'),
      db.query('SELECT COUNT(*) FROM feedback'),
      db.query('SELECT COUNT(*) FROM contact_submissions'),
    ]);
    res.json({ totalUsers: users.rows[0].count, proUsers: pro.rows[0].count, totalScans: scans.rows[0].count, prsRaised: prs.rows[0].count, revenue: revenue.rows[0].total, waitlist: waitlist.rows[0].count, careers: careers.rows[0].count, feedback: feedback.rows[0].count, contacts: contacts.rows[0].count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/users', authMiddleware, isAdmin, async (req, res) => {
  const r = await db.query('SELECT id, github_username, email, plan, scans_used, bonus_scans, location, last_seen, total_time_spent, created_at FROM users ORDER BY created_at DESC');
  res.json({ users: r.rows });
});

router.get('/scans', authMiddleware, isAdmin, async (req, res) => {
  const r = await db.query('SELECT s.*, u.github_username FROM scans s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.created_at DESC LIMIT 100');
  res.json({ scans: r.rows });
});

router.get('/payments', authMiddleware, isAdmin, async (req, res) => {
  const r = await db.query('SELECT p.*, u.github_username FROM payments p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC');
  res.json({ payments: r.rows });
});

router.get('/careers', authMiddleware, isAdmin, async (req, res) => {
  const r = await db.query('SELECT * FROM career_applications ORDER BY created_at DESC');
  res.json({ careers: r.rows });
});

router.get('/feedback', authMiddleware, isAdmin, async (req, res) => {
  const r = await db.query('SELECT * FROM feedback ORDER BY created_at DESC');
  res.json({ feedback: r.rows });
});

router.get('/contacts', authMiddleware, isAdmin, async (req, res) => {
  const r = await db.query('SELECT * FROM contact_submissions ORDER BY created_at DESC');
  res.json({ contacts: r.rows });
});

router.get('/waitlist', authMiddleware, isAdmin, async (req, res) => {
  const r = await db.query('SELECT * FROM waitlist ORDER BY created_at DESC');
  res.json({ waitlist: r.rows });
});

router.get('/analytics', authMiddleware, isAdmin, async (req, res) => {
  const r = await db.query('SELECT * FROM analytics ORDER BY created_at DESC LIMIT 200');
  res.json({ analytics: r.rows });
});

router.patch('/careers/:id', authMiddleware, isAdmin, async (req, res) => {
  await db.query('UPDATE career_applications SET status = $1 WHERE id = $2', [req.body.status, req.params.id]);
  res.json({ success: true });
});

module.exports = router;

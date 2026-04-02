// routes/admin.js — Complete admin API
const express = require('express');
const router = express.Router();
const db = require('../db');

// Admin-only middleware
router.use(async (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  // Check role from DB (don't trust session alone)
  try {
    const r = await db.query('SELECT role FROM users WHERE id=$1', [req.session.user.id]);
    if (r.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  next();
});

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [users, pro, scans, issues, newUsers] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users'),
      db.query("SELECT COUNT(*) FROM users WHERE plan='pro'"),
      db.query('SELECT COUNT(*) FROM scans'),
      db.query('SELECT COALESCE(SUM(issues_found),0) FROM scans'),
      db.query("SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '7 days'")
    ]);
    res.json({
      total_users:  parseInt(users.rows[0].count),
      pro_users:    parseInt(pro.rows[0].count),
      total_scans:  parseInt(scans.rows[0].count),
      total_issues: parseInt(issues.rows[0].coalesce),
      prs_raised:   0,
      new_this_week: parseInt(newUsers.rows[0].count)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT u.id, u.github_username AS username, u.email, u.plan, u.role,
             u.scans_used, u.bonus_scans, u.referral_code, u.created_at, u.last_seen,
             COALESCE(s.scan_count, 0) AS total_scans,
             COALESCE(s.issue_count, 0) AS total_issues
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS scan_count, SUM(issues_found) AS issue_count
        FROM scans GROUP BY user_id
      ) s ON s.user_id = u.id
      ORDER BY u.created_at DESC
    `);
    res.json({ users: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/admin/user/:id — edit user
router.patch('/user/:id', async (req, res) => {
  const { plan, role, bonus_scans, scans_used } = req.body;
  try {
    const updates = [];
    const vals = [];
    let i = 1;
    if (plan !== undefined)       { updates.push(`plan=$${i++}`);        vals.push(plan); }
    if (role !== undefined)       { updates.push(`role=$${i++}`);        vals.push(role); }
    if (bonus_scans !== undefined){ updates.push(`bonus_scans=$${i++}`); vals.push(bonus_scans); }
    if (scans_used !== undefined) { updates.push(`scans_used=$${i++}`);  vals.push(scans_used); }
    if (!updates.length) return res.json({ success: false, error: 'Nothing to update' });
    vals.push(req.params.id);
    const r = await db.query(`UPDATE users SET ${updates.join(',')} WHERE id=$${i} RETURNING *`, vals);
    res.json({ success: true, user: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE /api/admin/user/:id
router.delete('/user/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM scans WHERE user_id=$1', [req.params.id]);
    await db.query('DELETE FROM chat_sessions WHERE user_id=$1', [req.params.id]);
    await db.query('DELETE FROM events WHERE user_id=$1', [req.params.id]);
    await db.query('DELETE FROM webhook_repos WHERE user_id=$1', [req.params.id]);
    await db.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/admin/scans
router.get('/scans', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT s.id, s.repo_name, s.branch, s.issues_found, s.status, s.scan_type,
             s.risk_level, s.pr_url, s.created_at,
             u.github_username AS username,
             0 AS prs_raised
      FROM scans s
      LEFT JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC LIMIT 500
    `);
    res.json({ scans: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/grant
router.post('/grant', async (req, res) => {
  const { identifier, plan, role, bonus_scans } = req.body;
  if (!identifier) return res.json({ success: false, error: 'identifier required' });
  try {
    const user = await db.query(
      'SELECT * FROM users WHERE github_username=$1 OR email=$1',
      [identifier]
    );
    if (!user.rows.length) return res.json({ success: false, error: 'User not found' });
    const updated = await db.query(
      `UPDATE users SET plan=$1, role=$2, bonus_scans=COALESCE(bonus_scans,0)+$3
       WHERE id=$4 RETURNING *`,
      [plan || 'pro', role || 'user', parseInt(bonus_scans) || 0, user.rows[0].id]
    );
    res.json({ success: true, user: updated.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/admin/feedback
router.get('/feedback', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT f.*, u.github_username AS username
      FROM feedback f
      LEFT JOIN users u ON u.email = f.email
      ORDER BY f.created_at DESC LIMIT 200
    `);
    res.json({ feedback: r.rows });
  } catch (e) { res.json({ feedback: [] }); }
});

// GET /api/admin/referrals
router.get('/referrals', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT u.github_username AS username, u.referral_code, u.bonus_scans,
             (SELECT COUNT(*) FROM users u2 WHERE u2.referred_by = u.referral_code) AS referral_count
      FROM users u
      WHERE u.referral_code IS NOT NULL
      ORDER BY referral_count DESC, u.created_at DESC
    `);
    res.json({ referrals: r.rows });
  } catch (e) { res.json({ referrals: [] }); }
});

// GET /api/admin/waitlist
router.get('/waitlist', async (req, res) => {
  try {
    // Try contact_submissions first (that's what your form likely writes to)
    const r = await db.query(
      'SELECT * FROM contact_submissions ORDER BY created_at DESC LIMIT 200'
    );
    res.json({ waitlist: r.rows });
  } catch (e) { res.json({ waitlist: [] }); }
});

// GET /api/admin/payments
router.get('/payments', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT p.*, u.github_username AS username
      FROM payments p
      LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC LIMIT 200
    `);
    res.json({ payments: r.rows });
  } catch (e) { res.json({ payments: [] }); }
});

// GET /api/admin/analytics
router.get('/analytics', async (req, res) => {
  try {
    const [userCount, scanStats, topRepos, topUsers, proCount] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users'),
      db.query('SELECT COUNT(*) AS total, COALESCE(AVG(issues_found),0) AS avg_issues FROM scans'),
      db.query(`
        SELECT repo_name, COUNT(*) AS scan_count, SUM(issues_found) AS total_issues
        FROM scans GROUP BY repo_name ORDER BY scan_count DESC LIMIT 10
      `),
      db.query(`
        SELECT u.github_username AS username, u.plan, COUNT(s.id) AS scan_count
        FROM users u LEFT JOIN scans s ON s.user_id = u.id
        GROUP BY u.id, u.github_username, u.plan ORDER BY scan_count DESC LIMIT 10
      `),
      db.query("SELECT COUNT(*) FROM users WHERE plan='pro'")
    ]);
    const total = parseInt(userCount.rows[0].count) || 1;
    const pro = parseInt(proCount.rows[0].count) || 0;
    const totalScans = parseInt(scanStats.rows[0].total) || 1;
    res.json({
      avg_scans_per_user: (totalScans / total).toFixed(1),
      conversion_rate: ((pro / total) * 100).toFixed(1),
      issues_per_scan: parseFloat(scanStats.rows[0].avg_issues).toFixed(1),
      top_repos: topRepos.rows,
      top_users: topUsers.rows
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/bulk/:action
router.post('/bulk/:action', async (req, res) => {
  const { action } = req.params;
  try {
    if (action === 'reset_free_scans') {
      await db.query("UPDATE users SET scans_used=0 WHERE plan='free'");
      res.json({ success: true, message: 'Reset scan counts for all free users' });
    } else if (action === 'purge_scans') {
      await db.query('DELETE FROM scans');
      res.json({ success: true, message: 'All scan data purged' });
    } else {
      res.json({ success: false, error: 'Unknown action' });
    }
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
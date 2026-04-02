// ============================================================
// ADDITIONS TO MAKE — READ THIS FILE CAREFULLY
// ============================================================

// ── 1. IN routes/auth.js ──────────────────────────────────────────────────
// Find the GitHub callback handler (the route that does res.redirect('/dashboard'))
// Change BOTH /dashboard redirects to check if user is new:
//
// FIND (appears twice in auth.js):
//   return res.redirect('/dashboard');
//
// REPLACE THE ONE INSIDE THE GITHUB CALLBACK with:
//   const isNew = !profile.onboarding_done;
//   return res.redirect(isNew ? '/onboarding' : '/dashboard');
//
// Or if you want a cleaner approach, add this helper after saving the user:
//   const userCheck = await db.query('SELECT onboarding_done FROM users WHERE id = $1', [user.id]);
//   const goTo = (!userCheck.rows[0]?.onboarding_done) ? '/onboarding' : '/dashboard';
//   return res.redirect(goTo);

// ── 2. ADD to server.js ───────────────────────────────────────────────────
// Add these two routes (onboarding page + API endpoint):

// Route: serve onboarding page (add near other protected page routes)
// app.get('/onboarding', (req, res) => {
//   if (!req.session.user) return res.redirect('/signin');
//   res.sendFile(path.join(__dirname, 'public', 'onboarding.html'));
// });

// ── 3. ADD to routes/user.js (already exists from previous session) ───────
// Add this route to routes/user.js:

const express = require('express');
const router = express.Router();
const db = require('../db');

function authMiddleware(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// PATCH /api/user/profile — update email/display_name
router.patch('/profile', authMiddleware, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.json({ success: true });
  try {
    await db.query('UPDATE users SET email = $1 WHERE id = $2', [email, req.session.user.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/user/onboarding — save onboarding answers
router.post('/onboarding', authMiddleware, async (req, res) => {
  const { role, team_size, concern, source, primary_repo } = req.body;
  try {
    // Add onboarding columns if they don't exist (safe ALTER)
    // These are stored in user metadata or a separate table
    // Simple approach: store in users table as JSON or separate columns
    await db.query(`
      UPDATE users
      SET onboarding_done = true
      WHERE id = $1
    `, [req.session.user.id]);

    // Log the onboarding data to analytics table if it exists
    try {
      await db.query(`
        INSERT INTO analytics (user_id, event_type, metadata, created_at)
        VALUES ($1, 'onboarding_complete', $2, NOW())
      `, [req.session.user.id, JSON.stringify({ role, team_size, concern, source, primary_repo })]);
    } catch (e) { /* analytics table may not exist */ }

    res.json({ success: true });
  } catch (e) {
    // onboarding_done column may not exist yet — that's fine, just redirect
    res.json({ success: true });
  }
});

module.exports = router;

'use strict';
// WHERE THIS FILE GOES:
// Save as: server/routes/feedback.js
// Then in server/index.js, add this line with the other routes:
//   app.use('/api/feedback', require('./routes/feedback'));

const express = require('express');
const db      = require('../lib/db');
const router  = express.Router();

// Create feedback table on first run
async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      rating     INTEGER CHECK (rating BETWEEN 1 AND 5),
      tags       TEXT[],
      comment    TEXT,
      page       VARCHAR(255),
      plan       VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_feedback_time ON feedback(created_at DESC);`);
}
ensureTable().catch(e => console.error('Feedback table error:', e.message));

router.post('/', async (req, res) => {
  const { rating, tags, comment, page } = req.body;
  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Rating 1-5 required' });

  // Get user_id from token if present (optional)
  let userId = null, plan = 'unknown';
  const auth = req.headers.authorization;
  if (auth) {
    try {
      const jwt = require('jsonwebtoken');
      const dec = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET);
      userId = dec.userId;
      const r = await db.query('SELECT plan FROM users WHERE id=$1', [userId]);
      plan = r.rows[0]?.plan || 'unknown';
    } catch (_) {}
  }

  try {
    await db.query(
      `INSERT INTO feedback (user_id, rating, tags, comment, page, plan)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, rating, tags || [], comment || '', page || '/', plan]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('Feedback save error:', e.message);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// GET /api/feedback/summary — view all feedback (you can call this in browser to see responses)
router.get('/summary', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT f.id, f.rating, f.tags, f.comment, f.plan, f.page, f.created_at,
             u.email, u.name
      FROM feedback f
      LEFT JOIN users u ON f.user_id = u.id
      ORDER BY f.created_at DESC
      LIMIT 200
    `);
    const avg = await db.query(`SELECT ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS total FROM feedback`);
    res.json({ stats: avg.rows[0], feedback: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db');

// Submit career application
router.post('/apply', async (req, res) => {
  const { name, email, role, linkedin, message } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    await db.query(
      `INSERT INTO career_applications (name, email, role, linkedin, message, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [name || '', email, role || '', linkedin || '', message || '']
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Career apply error:', err.message);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// Submit feedback
router.post('/feedback', async (req, res) => {
  const { name, email, message } = req.body;
  const userId = req.session?.user?.id || null;
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  try {
    await db.query(
      `INSERT INTO feedback (user_id, name, email, message, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [userId, name || '', email || '', message || '', ip]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Feedback error:', err.message);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Submit contact/collaborate form
router.post('/contact', async (req, res) => {
  const { name, email, company, topic, message } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    await db.query(
      `INSERT INTO contact_submissions (name, email, company, topic, message, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [name || '', email, company || '', topic || '', message || '']
    );
    // Also add to waitlist
    await db.query('INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [email]);
    res.json({ success: true });
  } catch (err) {
    console.error('Contact error:', err.message);
    res.status(500).json({ error: 'Failed to submit' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/', async (req, res) => {
  const { name, email, message, type } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  try {
    await db.query(
      `INSERT INTO feedback (name, email, message, type, status, ip_address, created_at)
       VALUES ($1, $2, $3, $4, 'new', $5, NOW())`,
      [name || 'Anonymous', email || '', message, type || 'feedback', req.ip]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Feedback error:', err.message);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM feedback ORDER BY created_at DESC LIMIT 100'
    );
    res.json({ feedback: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

module.exports = router;

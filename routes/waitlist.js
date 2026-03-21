const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/', async (req, res) => {
  const { email, message } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    // Save to waitlist - this is the primary action, must succeed
    await db.query(
      'INSERT INTO waitlist (email, created_at) VALUES ($1, NOW()) ON CONFLICT (email) DO NOTHING',
      [email]
    );

    // Try to send confirmation email - don't crash if it fails
    try {
      const { sendWaitlistEmail } = require('../services/emailService');
      if (sendWaitlistEmail) {
        await sendWaitlistEmail(email).catch(e => {
          console.error('Waitlist email failed (non-fatal):', e.message);
        });
      }
    } catch (emailErr) {
      console.error('Email service error (non-fatal):', emailErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Waitlist error:', err.message);
    res.status(500).json({ error: 'Failed to save' });
  }
});

module.exports = router;

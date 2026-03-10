'use strict';
const { Router } = require('express');
const db = require('../lib/db');

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ error: 'Name, email and message required' });
    await db.query(
      `INSERT INTO contact_messages(name, email, subject, message) VALUES($1,$2,$3,$4)`,
      [name, email.toLowerCase(), subject || null, message]
    );
    res.status(201).json({ ok: true, message: 'Message received! We will get back to you soon.' });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;

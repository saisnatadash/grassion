'use strict';
const express = require('express');
const db      = require('../lib/db');
const router  = express.Router();

// Early access signup
router.post('/', async (req, res) => {
  const { email, source, ref } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  try {
    await db.query(
      `INSERT INTO early_access (email, source, ref_code) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET source=EXCLUDED.source`,
      [email.toLowerCase(), source || 'landing', ref || null]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;

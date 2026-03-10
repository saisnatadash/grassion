'use strict';
const { Router } = require('express');
const db = require('../lib/db');
const { sendEarlyAccessConfirmation } = require('../lib/mailer');

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { email, name, company, role, use_case } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const result = await db.query(
      `INSERT INTO early_access(email, name, company, role, use_case)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [email.toLowerCase(), name || null, company || null, role || null, use_case || null]
    );

    try { await sendEarlyAccessConfirmation(email, name || email.split('@')[0]); } catch(e) { console.log('Email skipped:', e.message); }

    try {
      await db.query(`INSERT INTO audit_log(action, resource, meta, ip) VALUES('early_access','early_access',$1,$2)`,
        [JSON.stringify({ email }), req.ip]);
    } catch {}

    res.status(201).json({ ok: true, message: "You're on the list! Check your email." });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Already on the list!' });
    console.error(e);
    res.status(500).json({ error: 'Failed to join' });
  }
});

module.exports = router;

'use strict';
const express = require('express');
const db      = require('../lib/db');
const router  = express.Router();

router.post('/', async (req, res) => {
  const { type, name, email, ...rest } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  try {
    await db.query(
      `INSERT INTO contact_submissions (type,name,email,data) VALUES ($1,$2,$3,$4)`,
      [type || 'general', name, email, JSON.stringify(rest)]
    );
    if (process.env.SMTP_HOST) {
      const nodemailer = require('nodemailer');
      const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT||587, auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS} });
      t.sendMail({ from:'Grassion <info@grassion.com>', to:process.env.NOTIFY_EMAIL||'info@grassion.com',
        subject:`[${type}] ${name}`, text:`From: ${name} <${email}>\n\n${JSON.stringify(rest,null,2)}` }).catch(()=>{});
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;

'use strict';
require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const path        = require('path');
const rateLimit   = require('express-rate-limit');
const db          = require('./lib/db');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true }));

// Static files
app.use(express.static(path.join(__dirname, '../web/public')));

// API routes
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/github',       require('./routes/github'));
app.use('/api/billing',      require('./routes/billing'));
app.use('/api/early-access', require('./routes/earlyaccess'));
app.use('/api/contact',      require('./routes/contact'));
app.get('/api/health',       (_, res) => res.json({ ok: true, ts: new Date() }));

// Page routes
app.get('/about',    (_, res) => res.sendFile(path.join(__dirname, '../web/public/about.html')));
app.get('/contact',  (_, res) => res.sendFile(path.join(__dirname, '../web/public/contact.html')));
app.get('/dashboard',(_, res) => res.sendFile(path.join(__dirname, '../web/public/dashboard.html')));
app.get('*',         (_, res) => res.sendFile(path.join(__dirname, '../web/public/index.html')));

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : err.message });
});

async function start() {
  await db.connect();  console.log('✓ DB connected');
  await db.migrate();  console.log('✓ Migrations done');
  app.listen(PORT, () => console.log(`✓ Grassion on :${PORT}`));
}

start().catch(e => { console.error(e); process.exit(1); });

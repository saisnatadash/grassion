'use strict';
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const path        = require('path');
const rateLimit   = require('express-rate-limit');
const db          = require('./lib/db');

const app  = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

// Static files
app.use(express.static(path.join(__dirname, '../../web/public')));

// Routes
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/github',       require('./routes/github'));
app.use('/api/billing',      require('./routes/billing'));
app.use('/api/early-access', require('./routes/earlyaccess'));
app.use('/api/contact',      require('./routes/contact'));
app.use('/api/dashboard',    require('./routes/dashboard'));
app.get('/api/health',       (_req, res) => res.json({ ok: true, ts: new Date(), version: '2.0.0' }));

// SPA fallback
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../../web/public/index.html')));

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  await db.connect();  console.log('✓ DB connected');
  await db.migrate();  console.log('✓ Tables ready');
  app.listen(PORT, () => console.log(`✓ Grassion running on port ${PORT}`));
}

start().catch(e => { console.error(e); process.exit(1); });

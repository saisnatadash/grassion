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
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

// ── Static files (CSS, JS, images, etc.) ──
// FIX: serve static files FIRST before any catch-all route
app.use(express.static(path.join(__dirname, '../../web/public'), {
  // Don't fall through to next middleware for real files
  fallthrough: true,
  // Set proper cache headers
  etag: true,
  lastModified: true,
}));

// ── API Routes ──
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/github',       require('./routes/github'));
app.use('/api/billing',      require('./routes/billing'));
app.use('/api/early-access', require('./routes/earlyaccess'));
app.use('/api/contact',      require('./routes/contact'));
app.use('/api/dashboard',    require('./routes/dashboard'));
app.get('/api/health',       (_req, res) => res.json({ ok: true, ts: new Date(), version: '2.0.0' }));

// ── SPA fallback — ONLY for non-file, non-API routes ──
// FIX: Don't serve index.html for requests that look like files (.js, .css, .png etc.)
// This was causing "Unexpected token '<'" errors on script/style loads
app.get('*', (req, res, next) => {
  // If the request has a file extension, let it 404 normally (don't serve index.html)
  if (path.extname(req.path)) {
    return res.status(404).json({ error: `File not found: ${req.path}` });
  }
  // API routes that don't match should 404 as JSON
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  // All other routes (page navigation) → serve the SPA
  res.sendFile(path.join(__dirname, '../../web/public/index.html'));
});

// ── Error handler ──
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

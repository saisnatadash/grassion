console.log("NEW BUILD DEPLOY TEST");

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const db = require('./db');
const app = express();
app.set('db', db);

// Trust Railway proxy
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Force no-cache on ALL HTML pages so Cloudflare/browser never serves stale versions
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || !req.path.includes('.')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  next();
});


app.get('/favicon.ico', (req, res) => {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, 'public', 'img', 'logo.png'));
});

// Static files (images, CSS, JS) — cache these fine
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    // Don't cache HTML
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// Session store
app.use(session({
  store: new pgSession({
    pool: db,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'grassionsecret2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// ── ROUTES ──
app.use('/auth', require('./routes/auth'));
app.use('/api/repos', require('./routes/repos'));
app.use('/api/scanner', require('./routes/scanner'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/waitlist', require('./routes/waitlist'));
app.use('/api/referral', require('./routes/referral'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/careers', require('./routes/careers'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/user', require('./routes/user'));      // ← NEW: user profile + onboarding
app.use('/webhook', require('./routes/webhook'));   // ← PR Guardrail

// ── PUBLIC PAGES ──
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public', 'about.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contact.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pricing.html')));

app.get('/signin', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'signin.html'));
});
app.get('/signup', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// ── PROTECTED PAGES ──
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/signin');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/admin', (req, res) => {
  if (!req.session.user) return res.redirect('/signin');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/settings', (req, res) => {
  if (!req.session.user) return res.redirect('/signin');
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});
app.get('/chat', (req, res) => {
  if (!req.session.user) return res.redirect('/signin');
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// ── ONBOARDING (first-time users after GitHub OAuth) ──
app.get('/onboarding', (req, res) => {
  if (!req.session.user) return res.redirect('/signin');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'onboarding.html'));
});

// ── 404 ──
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[Grassion] Running on port ${PORT}`);
  console.log(`[Grassion] Env: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Grassion] OpenAI: ${process.env.OPENAI_API_KEY ? 'configured' : 'MISSING - Code Guardian will not work'}`);
});
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const db = require('./db');
const app = express();
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// PostgreSQL session store — eliminates MemoryStore warning permanently
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
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// Routes
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
app.use('/webhook', require('./routes/webhook'));

// Public pages
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/signup', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});
app.get('/signin', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'signin.html'));
});
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pricing.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public', 'about.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contact.html')));

// Protected pages
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/signin');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/settings', (req, res) => {
  if (!req.session.user) return res.redirect('/signin');
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});
app.get('/admin', (req, res) => {
  if (!req.session.user) return res.redirect('/signin');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/chat', (req, res) => {
  if (!req.session.user) return res.redirect('/signin');
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// 404 fallback
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[Grassion] Running on port ${PORT}`);
  console.log(`[Grassion] Environment: ${process.env.NODE_ENV || 'development'}`);
});
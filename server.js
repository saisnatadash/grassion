require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Use connect-pg-simple for production session store to fix MemoryStore warning
let sessionStore;
try {
  const pgSession = require('connect-pg-simple')(session);
  const db = require('./db');
  sessionStore = new pgSession({
    pool: db,
    tableName: 'session',
    createTableIfMissing: true
  });
} catch(e) {
  console.log('Using MemoryStore for sessions (ok for dev)');
  sessionStore = undefined;
}

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'grassionsecret2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
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

// Pro-only AI chat page
app.get('/chat', (req, res) => {
  if (!req.session.user) return res.redirect('/signin');
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Grassion running on port ${PORT}`));

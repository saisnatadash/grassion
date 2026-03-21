const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Run schema setup after short delay to avoid startup race conditions
setTimeout(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT PRIMARY KEY,
        github_username TEXT UNIQUE,
        avatar_url TEXT,
        email TEXT,
        access_token TEXT,
        plan TEXT DEFAULT 'free',
        role TEXT DEFAULT 'user',
        scans_used INTEGER DEFAULT 0,
        bonus_scans INTEGER DEFAULT 0,
        referral_code TEXT,
        referred_by TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY, user_id BIGINT, repo_name TEXT,
      total_issues INTEGER DEFAULT 0, results JSONB, pr_url TEXT,
      pr_raised BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY, email TEXT UNIQUE, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY, user_id BIGINT, github_username TEXT,
      order_id TEXT, payment_id TEXT, amount INTEGER, status TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS feedback (
      id SERIAL PRIMARY KEY, name TEXT, email TEXT, message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS contact_submissions (
      id SERIAL PRIMARY KEY, name TEXT, email TEXT, company TEXT,
      topic TEXT, message TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS career_applications (
      id SERIAL PRIMARY KEY, name TEXT, email TEXT, role TEXT,
      linkedin TEXT, message TEXT, status TEXT DEFAULT 'new',
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS analytics (
      id SERIAL PRIMARY KEY, event_type TEXT, page TEXT,
      ip_address TEXT, user_id BIGINT, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS webhook_repos (
      id SERIAL PRIMARY KEY, user_id BIGINT, repo_name TEXT,
      webhook_id TEXT, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS chat_sessions (
      id SERIAL PRIMARY KEY, user_id BIGINT, repo TEXT,
      branch TEXT DEFAULT 'main', prompt TEXT, summary TEXT,
      changes JSONB, pr_url TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);

    console.log('[DB] All tables ready');

    // Founder gets pro+admin on every startup
    await pool.query(`
      INSERT INTO users (id, github_username, email, avatar_url, plan, role, scans_used, bonus_scans, referral_code)
      VALUES (32237562, 'saisnatadash', 'dsaisnata@gmail.com', 'https://avatars.githubusercontent.com/u/32237562', 'pro', 'admin', 0, 0, 'SAI001')
      ON CONFLICT (id) DO UPDATE SET plan = 'pro', role = 'admin'
    `);

    console.log('[DB] Founder account confirmed pro/admin');
  } catch (e) {
    console.error('[DB] Setup error (non-fatal):', e.message);
  }
}, 2000);

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

module.exports = pool;
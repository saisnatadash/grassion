const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.connect(async (err, client, release) => {
  if (err) { console.error('[DB] Connection error:', err.message); return; }
  console.log('[DB] Connected');
  try {
    await client.query('SET search_path TO public');

    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY, github_username TEXT UNIQUE, avatar_url TEXT, email TEXT,
      access_token TEXT, github_access_token TEXT,
      plan TEXT DEFAULT 'free', plan_expires TIMESTAMP,
      role TEXT DEFAULT 'user',
      scans_used INTEGER DEFAULT 0, bonus_scans INTEGER DEFAULT 0,
      referral_code TEXT, referred_by TEXT, location TEXT, total_time_spent INTEGER DEFAULT 0,
      onboarding_done BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(), last_seen TIMESTAMP DEFAULT NOW()
    )`);

    const addCols = [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS github_access_token TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_done BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires TIMESTAMP`,
      `ALTER TABLE scans ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'SAFE'`,
      `ALTER TABLE scans ADD COLUMN IF NOT EXISTS scan_type TEXT DEFAULT 'manual'`,
      `ALTER TABLE scans ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT 'main'`,
      `ALTER TABLE scans ADD COLUMN IF NOT EXISTS issues_found INTEGER DEFAULT 0`
    ];
    for (const sql of addCols) {
      try { await client.query(sql); } catch(e) { }
    }

    await client.query(`CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY, user_id BIGINT, repo_name TEXT, branch TEXT DEFAULT 'main',
      issues_found INTEGER DEFAULT 0, status TEXT DEFAULT 'completed',
      scan_type TEXT DEFAULT 'manual', risk_level TEXT DEFAULT 'SAFE',
      results JSONB, pr_url TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY, email TEXT UNIQUE, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY, user_id BIGINT, github_username TEXT,
      order_id TEXT, payment_id TEXT, amount INTEGER, status TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS feedback (
      id SERIAL PRIMARY KEY, name TEXT, email TEXT, message TEXT,
      ip_address TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS contact_submissions (
      id SERIAL PRIMARY KEY, name TEXT, email TEXT, company TEXT,
      topic TEXT, message TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS career_applications (
      id SERIAL PRIMARY KEY, name TEXT, email TEXT, role TEXT, linkedin TEXT,
      message TEXT, status TEXT DEFAULT 'new', created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS analytics (
      id SERIAL PRIMARY KEY, event_type TEXT, page TEXT, location TEXT,
      ip_address TEXT, user_id BIGINT, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS webhook_repos (
      id SERIAL PRIMARY KEY, user_id BIGINT, repo_full_name TEXT, hook_id TEXT,
      active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, repo_full_name)
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY, user_id BIGINT, type TEXT,
      repo_name TEXT, metadata JSONB, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS chat_sessions (
      id SERIAL PRIMARY KEY, user_id BIGINT, repo_name TEXT, pr_branch TEXT DEFAULT 'main',
      prompt TEXT, summary TEXT, conversation_history JSONB DEFAULT '[]',
      risk_level TEXT DEFAULT 'LOW', files_changed INTEGER DEFAULT 0,
      pr_url TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS session (
      sid TEXT NOT NULL PRIMARY KEY, sess JSONB NOT NULL, expire TIMESTAMP NOT NULL
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS session_expire_idx ON session(expire)`);

    // Ensure unique constraint exists before upsert
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_github_username_idx ON users(github_username)`);

    // Ensure founder is always pro+admin - UPDATE only, no INSERT risk
    await client.query(`UPDATE users SET plan='pro', role='admin', last_seen=NOW() WHERE github_username='saisnatadash'`);
    // If row doesnt exist yet (first ever boot), insert it
    await client.query(`
      INSERT INTO users (github_username, email, avatar_url, plan, role, scans_used, bonus_scans, referral_code, created_at, last_seen)
      SELECT 'saisnatadash', 'dsaisnata@gmail.com', 'https://avatars.githubusercontent.com/u/32237562', 'pro', 'admin', 0, 0, 'SAI001', NOW(), NOW()
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE github_username='saisnatadash')
    `);

    console.log('[DB] Schema ready. Founder: pro/admin.');
  } catch (e) {
    console.error('[DB] Schema error:', e.message);
  } finally {
    release();
  }
});

module.exports = pool;
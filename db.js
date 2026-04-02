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
      id BIGSERIAL PRIMARY KEY,
      github_id TEXT,
      github_username TEXT,
      avatar_url TEXT,
      email TEXT,
      access_token TEXT,
      github_access_token TEXT,
      plan TEXT DEFAULT 'free',
      plan_expires TIMESTAMP,
      role TEXT DEFAULT 'user',
      scans_used INTEGER DEFAULT 0,
      bonus_scans INTEGER DEFAULT 0,
      referral_code TEXT,
      referred_by TEXT,
      location TEXT,
      total_time_spent INTEGER DEFAULT 0,
      onboarding_done BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      last_seen TIMESTAMP DEFAULT NOW()
    )`);

    // Safe column additions for existing Railway installs
    const addCols = [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS github_access_token TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_done BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires TIMESTAMP`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'`,
    ];
    for (const sql of addCols) {
      try { await client.query(sql); } catch(e) { }
    }

    // Clean duplicate github_usernames before creating unique index
    await client.query(`
      DELETE FROM users
      WHERE id NOT IN (
        SELECT MIN(id) FROM users
        WHERE github_username IS NOT NULL
        GROUP BY github_username
      )
      AND github_username IS NOT NULL
    `);

    // Now safe to create unique index
    try {
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_github_username_unique ON users(github_username) WHERE github_username IS NOT NULL`);
    } catch(e) { /* index may already exist */ }

    await client.query(`CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY,
      user_id BIGINT,
      repo_name TEXT,
      branch TEXT DEFAULT 'main',
      issues_found INTEGER DEFAULT 0,
      status TEXT DEFAULT 'completed',
      scan_type TEXT DEFAULT 'manual',
      risk_level TEXT DEFAULT 'SAFE',
      results JSONB,
      pr_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    const addScanCols = [
      `ALTER TABLE scans ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'SAFE'`,
      `ALTER TABLE scans ADD COLUMN IF NOT EXISTS scan_type TEXT DEFAULT 'manual'`,
      `ALTER TABLE scans ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT 'main'`,
      `ALTER TABLE scans ADD COLUMN IF NOT EXISTS issues_found INTEGER DEFAULT 0`
    ];
    for (const sql of addScanCols) {
      try { await client.query(sql); } catch(e) { }
    }

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

    // Ensure founder is always pro+admin - simple UPDATE, no conflict needed
    await client.query(`UPDATE users SET plan='pro', role='admin', last_seen=NOW() WHERE github_username='saisnatadash'`);

    console.log('[DB] Schema ready.');
  } catch (e) {
    console.error('[DB] Schema error:', e.message);
  } finally {
    release();
  }
});

module.exports = pool;
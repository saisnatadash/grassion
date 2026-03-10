'use strict';
const { Pool } = require('pg');

let pool;

async function connect() {
  // Try DATABASE_URL first, fall back to DATABASE_PUBLIC_URL
  const connStr = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
  if (!connStr) throw new Error('No DATABASE_URL or DATABASE_PUBLIC_URL environment variable set');

  pool = new Pool({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  await pool.query('SELECT 1');
  const host = connStr.split('@')[1]?.split('/')[0] || 'unknown';
  console.log('✓ DB connected to:', host);
}

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      name          VARCHAR(255),
      avatar_url    VARCHAR(500),
      github_id     VARCHAR(100),
      plan          VARCHAR(50)  DEFAULT 'free',
      subscription_status VARCHAR(50) DEFAULT 'inactive',
      subscription_end_date TIMESTAMPTZ,
      razorpay_customer_id  VARCHAR(100),
      razorpay_sub_id       VARCHAR(100),
      email_verified BOOLEAN DEFAULT false,
      verify_token   VARCHAR(100),
      reset_token    VARCHAR(100),
      reset_expires  TIMESTAMPTZ,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS early_access (
      id         SERIAL PRIMARY KEY,
      email      VARCHAR(255) UNIQUE NOT NULL,
      name       VARCHAR(255),
      company    VARCHAR(255),
      role       VARCHAR(255),
      use_case   TEXT,
      status     VARCHAR(50) DEFAULT 'pending',
      invited_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contact_messages (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(255) NOT NULL,
      email      VARCHAR(255) NOT NULL,
      subject    VARCHAR(500),
      message    TEXT NOT NULL,
      status     VARCHAR(50) DEFAULT 'unread',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS repos (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      github_repo  VARCHAR(500) NOT NULL,
      owner        VARCHAR(255) NOT NULL,
      repo_name    VARCHAR(255) NOT NULL,
      enabled      BOOLEAN DEFAULT true,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pr_events (
      id           SERIAL PRIMARY KEY,
      repo_id      INTEGER REFERENCES repos(id) ON DELETE CASCADE,
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      pr_number    INTEGER NOT NULL,
      pr_title     VARCHAR(500),
      pr_author    VARCHAR(255),
      action       VARCHAR(100),
      risk_level   VARCHAR(50),
      risk_reason  TEXT,
      ai_summary   TEXT,
      blocked      BOOLEAN DEFAULT false,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action     VARCHAR(255) NOT NULL,
      resource   VARCHAR(255),
      meta       JSONB,
      ip         VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id                  SERIAL PRIMARY KEY,
      user_id             INTEGER REFERENCES users(id) ON DELETE CASCADE,
      razorpay_order_id   VARCHAR(100),
      razorpay_payment_id VARCHAR(100),
      amount              INTEGER,
      currency            VARCHAR(10) DEFAULT 'INR',
      plan                VARCHAR(50),
      status              VARCHAR(50) DEFAULT 'pending',
      created_at          TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id             SERIAL PRIMARY KEY,
      repo_id        INTEGER REFERENCES repos(id) ON DELETE CASCADE,
      github_hook_id BIGINT,
      secret         VARCHAR(100),
      created_at     TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title      VARCHAR(255) NOT NULL,
      body       TEXT,
      type       VARCHAR(50),
      read       BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

module.exports = { connect, query, getClient, migrate };

'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const query = (text, params) => pool.query(text, params);

async function connect() {
  const c = await pool.connect();
  c.release();
  return true;
}

async function migrate() {
  // ── USERS ──────────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id                      SERIAL PRIMARY KEY,
      email                   VARCHAR(255) UNIQUE NOT NULL,
      password_hash           VARCHAR(255) NOT NULL,
      name                    VARCHAR(255),
      plan                    VARCHAR(50)  DEFAULT 'free',
      api_token               VARCHAR(255) UNIQUE,
      github_installation_id  VARCHAR(255),
      github_username         VARCHAR(255),
      razorpay_customer_id    VARCHAR(255),
      subscription_status     VARCHAR(50)  DEFAULT 'inactive',
      subscription_end_date   TIMESTAMPTZ,
      referral_code           VARCHAR(32)  UNIQUE,
      referred_by             VARCHAR(32),
      referral_count          INTEGER      DEFAULT 0,
      referral_months_earned  INTEGER      DEFAULT 0,
      free_months_remaining   INTEGER      DEFAULT 0,
      early_access            BOOLEAN      DEFAULT false,
      created_at              TIMESTAMPTZ  DEFAULT NOW(),
      updated_at              TIMESTAMPTZ  DEFAULT NOW()
    );
  `);

  // ── EARLY ACCESS LIST ──────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS early_access (
      id         SERIAL PRIMARY KEY,
      email      VARCHAR(255) UNIQUE NOT NULL,
      source     VARCHAR(100) DEFAULT 'landing',
      ref_code   VARCHAR(32),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // ── GITHUB REPOSITORIES ───────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS repositories (
      id                SERIAL PRIMARY KEY,
      user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
      github_repo_id    BIGINT  UNIQUE,
      full_name         VARCHAR(255) NOT NULL,
      owner             VARCHAR(255),
      name              VARCHAR(255),
      installation_id   VARCHAR(255),
      default_branch    VARCHAR(100) DEFAULT 'main',
      indexed           BOOLEAN      DEFAULT false,
      pr_count_indexed  INTEGER      DEFAULT 0,
      guardrail_count   INTEGER      DEFAULT 0,
      block_on_critical BOOLEAN      DEFAULT false,
      indexed_at        TIMESTAMPTZ,
      last_scan_at      TIMESTAMPTZ,
      created_at        TIMESTAMPTZ  DEFAULT NOW(),
      updated_at        TIMESTAMPTZ  DEFAULT NOW()
    );
  `);

  // ── GUARDRAIL EVENTS (every PR warning fired) ─────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS guardrail_events (
      id              SERIAL PRIMARY KEY,
      repo_id         INTEGER REFERENCES repositories(id) ON DELETE CASCADE,
      pr_number       INTEGER      NOT NULL,
      pr_title        VARCHAR(500),
      pr_author       VARCHAR(255),
      pr_url          VARCHAR(500),
      triggered_key   VARCHAR(255),
      changed_from    VARCHAR(500),
      changed_to      VARCHAR(500),
      risk_level      VARCHAR(50)  DEFAULT 'medium',
      matched_pr      INTEGER,
      matched_pr_url  VARCHAR(500),
      comment_id      BIGINT,
      comment_url     VARCHAR(500),
      plan_tier       VARCHAR(50)  DEFAULT 'free',
      action_taken    VARCHAR(50)  DEFAULT 'warned',
      created_at      TIMESTAMPTZ  DEFAULT NOW()
    );
  `);

  // ── INCIDENT HISTORY (Pro feature) ────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS incident_history (
      id              SERIAL PRIMARY KEY,
      repo_id         INTEGER REFERENCES repositories(id) ON DELETE CASCADE,
      user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title           VARCHAR(500) NOT NULL,
      description     TEXT,
      root_cause      TEXT,
      resolution      TEXT,
      config_keys     TEXT[],
      severity        VARCHAR(10)  DEFAULT 'P2',
      downtime_mins   INTEGER,
      affected_users  INTEGER,
      occurred_at     TIMESTAMPTZ,
      resolved_at     TIMESTAMPTZ,
      pr_number       INTEGER,
      pr_url          VARCHAR(500),
      slack_thread_url VARCHAR(500),
      runbook_url     VARCHAR(500),
      created_at      TIMESTAMPTZ  DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  DEFAULT NOW()
    );
  `);

  // ── PAYMENTS ──────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS payments (
      id                    SERIAL PRIMARY KEY,
      user_id               INTEGER REFERENCES users(id) ON DELETE CASCADE,
      razorpay_order_id     VARCHAR(255),
      razorpay_payment_id   VARCHAR(255),
      razorpay_signature    VARCHAR(500),
      amount_paise          INTEGER,
      amount_inr            NUMERIC(10,2),
      currency              VARCHAR(10)  DEFAULT 'INR',
      plan                  VARCHAR(50),
      billing_period_months INTEGER      DEFAULT 1,
      status                VARCHAR(50),
      refunded              BOOLEAN      DEFAULT false,
      notes                 JSONB,
      created_at            TIMESTAMPTZ  DEFAULT NOW()
    );
  `);

  // ── REFERRALS ─────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS referrals (
      id              SERIAL PRIMARY KEY,
      referrer_code   VARCHAR(32)  NOT NULL,
      referrer_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      referred_email  VARCHAR(255),
      referred_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status          VARCHAR(50)  DEFAULT 'pending',
      reward_granted  BOOLEAN      DEFAULT false,
      reward_type     VARCHAR(100),
      created_at      TIMESTAMPTZ  DEFAULT NOW(),
      converted_at    TIMESTAMPTZ
    );
  `);

  // ── CONTACT SUBMISSIONS ───────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS contact_submissions (
      id         SERIAL PRIMARY KEY,
      type       VARCHAR(50),
      name       VARCHAR(255),
      email      VARCHAR(255),
      data       JSONB,
      replied    BOOLEAN      DEFAULT false,
      created_at TIMESTAMPTZ  DEFAULT NOW()
    );
  `);

  // ── AUDIT LOG (every significant event) ──────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id         BIGSERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      repo_id    INTEGER REFERENCES repositories(id) ON DELETE SET NULL,
      event_type VARCHAR(100) NOT NULL,
      event_data JSONB,
      ip_address VARCHAR(50),
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // ── WEEKLY DIGESTS (sent tracker) ─────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS digest_sends (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      week_of    DATE        NOT NULL,
      events_ct  INTEGER     DEFAULT 0,
      sent_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, week_of)
    );
  `);

  // ── INDEXES ───────────────────────────────────────────────────────────────
  await query(`CREATE INDEX IF NOT EXISTS idx_ge_repo      ON guardrail_events(repo_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ge_created   ON guardrail_events(created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ge_key       ON guardrail_events(triggered_key);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_repos_user   ON repositories(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ih_repo      ON incident_history(repo_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ih_keys      ON incident_history USING GIN(config_keys);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ref_code     ON referrals(referrer_code);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_log(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_type   ON audit_log(event_type);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_time   ON audit_log(created_at DESC);`);
}

module.exports = { query, connect, migrate, pool };

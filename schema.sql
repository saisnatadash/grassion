CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  github_username VARCHAR(255) UNIQUE NOT NULL,
  avatar_url TEXT,
  email VARCHAR(255),
  plan VARCHAR(50) DEFAULT 'free',
  plan_expires TIMESTAMP,
  access_token TEXT,
  scans_used INTEGER DEFAULT 0,
  bonus_scans INTEGER DEFAULT 0,
  referral_code VARCHAR(50) UNIQUE,
  referred_by VARCHAR(50),
  location VARCHAR(255),
  last_seen TIMESTAMP,
  total_time_spent INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scans (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  repo_name VARCHAR(255),
  total_issues INTEGER DEFAULT 0,
  results JSONB,
  pr_url TEXT,
  pr_raised BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS waitlist (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_repos (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  repo_name VARCHAR(255),
  webhook_id BIGINT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics (
  id SERIAL PRIMARY KEY,
  user_id BIGINT,
  event_type VARCHAR(100),
  page VARCHAR(255),
  metadata JSONB,
  ip_address VARCHAR(50),
  location VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  order_id VARCHAR(255),
  payment_id VARCHAR(255),
  amount INTEGER,
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

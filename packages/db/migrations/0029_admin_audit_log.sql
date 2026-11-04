-- Admin-panel access log (founder-only routes).
-- Never stores secrets, tokens or token hashes.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              uuid      DEFAULT gen_random_uuid() PRIMARY KEY,
  github_login    text      NOT NULL,
  github_id       integer   NOT NULL,
  method          text      NOT NULL,
  route           text      NOT NULL,
  request_summary text,    -- sanitised body/query summary (no secrets)
  occurred_at     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_occurred_idx
  ON admin_audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_login_idx
  ON admin_audit_log(github_login, occurred_at DESC);

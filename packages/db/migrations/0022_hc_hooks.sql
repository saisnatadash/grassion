-- Migration 0022: HC check runs, MCP API tokens, evidence disputes,
--                  and new columns on teams for check-run settings.
-- Idempotent — all statements use IF NOT EXISTS / IF NOT EXISTS guards.

-- ── teams: HC check-run columns ──────────────────────────────────────────────

ALTER TABLE teams ADD COLUMN IF NOT EXISTS hc_check_run_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS hc_block_on_critical boolean NOT NULL DEFAULT false;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS hc_max_review_requests integer NOT NULL DEFAULT 5;

-- ── hc_check_runs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hc_check_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  repo_id         uuid NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  pr_number       integer NOT NULL,
  head_sha        text NOT NULL,
  check_run_id    text NOT NULL,
  conclusion      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS hc_check_runs_org_repo_pr_idx
  ON hc_check_runs(org_id, repo_id, pr_number);

CREATE INDEX IF NOT EXISTS hc_check_runs_check_run_id_idx
  ON hc_check_runs(check_run_id);

-- ── mcp_api_tokens ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mcp_api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  name         text NOT NULL,
  created_by   text NOT NULL,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mcp_api_tokens_hash_idx
  ON mcp_api_tokens(token_hash);

CREATE INDEX IF NOT EXISTS mcp_api_tokens_org_idx
  ON mcp_api_tokens(org_id);

-- ── hc_evidence_disputes ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hc_evidence_disputes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  evidence_id     uuid NOT NULL REFERENCES hc_evidence_events(id) ON DELETE CASCADE,
  reported_by     text NOT NULL,
  reason          text NOT NULL,
  admin_note      text,
  status          text NOT NULL DEFAULT 'pending',
  weight_override real,
  resolved_by     text,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hc_disputes_org_idx
  ON hc_evidence_disputes(org_id);

CREATE INDEX IF NOT EXISTS hc_disputes_evidence_idx
  ON hc_evidence_disputes(evidence_id);

CREATE INDEX IF NOT EXISTS hc_disputes_org_status_idx
  ON hc_evidence_disputes(org_id, status);

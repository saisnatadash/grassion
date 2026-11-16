-- Append-only attestation log for Merge Receipt.
-- Every check-run button click (understand / partly / ai_wrote_it) appends a new row.
-- prev_hash + row_hash form a tamper-evident SHA-256 chain per (org, pr_number).
CREATE TABLE IF NOT EXISTS hc_attestation_log (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  repo_id     UUID        NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  pr_number   INTEGER     NOT NULL,
  person_id   UUID        NOT NULL REFERENCES hc_people(id) ON DELETE CASCADE,
  answer      TEXT        NOT NULL,       -- understand | partly | ai_wrote_it
  note        TEXT,
  created_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
  prev_hash   TEXT        NOT NULL DEFAULT '',
  row_hash    TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS hc_attestation_log_org_pr_idx
  ON hc_attestation_log (org_id, pr_number, created_at);

CREATE INDEX IF NOT EXISTS hc_attestation_log_repo_pr_idx
  ON hc_attestation_log (repo_id, pr_number);

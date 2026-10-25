-- Repeat-Failure Guard: analysis runs, per-PR labels, per-PR file paths

CREATE TABLE IF NOT EXISTS "rfg_analysis_runs" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repo_id"       uuid NOT NULL REFERENCES "repos"("id") ON DELETE CASCADE,
  "team_id"       uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "status"        text NOT NULL DEFAULT 'pending',
  "cursor"        integer DEFAULT 1,
  "since_date"    timestamp NOT NULL,
  "prs_fetched"   integer DEFAULT 0,
  "error"         text,
  "started_at"    timestamp,
  "completed_at"  timestamp,
  "created_at"    timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "rfg_runs_repo_idx"  ON "rfg_analysis_runs" ("repo_id");
CREATE INDEX IF NOT EXISTS "rfg_runs_team_idx"  ON "rfg_analysis_runs" ("team_id");
CREATE INDEX IF NOT EXISTS "rfg_runs_status_idx" ON "rfg_analysis_runs" ("status");

CREATE TABLE IF NOT EXISTS "rfg_pr_labels" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id"            uuid NOT NULL REFERENCES "rfg_analysis_runs"("id") ON DELETE CASCADE,
  "repo_id"           uuid NOT NULL REFERENCES "repos"("id") ON DELETE CASCADE,
  "team_id"           uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "pr_number"         integer NOT NULL,
  "pr_title"          text NOT NULL,
  "pr_merged_at"      timestamp NOT NULL,
  "author_login"      text,
  "additions"         integer DEFAULT 0,
  "deletions"         integer DEFAULT 0,
  "changed_files"     integer DEFAULT 0,
  "has_test_changes"  boolean DEFAULT false,
  "label"             text,
  "label_reason"      text,
  "revert_pr_number"  integer,
  "hotfix_pr_number"  integer,
  "created_at"        timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "rfg_pr_labels_run_pr_idx" ON "rfg_pr_labels" ("run_id", "pr_number");
CREATE INDEX IF NOT EXISTS "rfg_pr_labels_repo_idx"  ON "rfg_pr_labels" ("repo_id");
CREATE INDEX IF NOT EXISTS "rfg_pr_labels_label_idx" ON "rfg_pr_labels" ("repo_id", "label");

CREATE TABLE IF NOT EXISTS "rfg_pr_file_paths" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pr_label_id"  uuid NOT NULL REFERENCES "rfg_pr_labels"("id") ON DELETE CASCADE,
  "repo_id"      uuid NOT NULL REFERENCES "repos"("id") ON DELETE CASCADE,
  "file_path"    text NOT NULL,
  "additions"    integer DEFAULT 0,
  "deletions"    integer DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "rfg_file_paths_pr_idx"   ON "rfg_pr_file_paths" ("pr_label_id");
CREATE INDEX IF NOT EXISTS "rfg_file_paths_repo_idx" ON "rfg_pr_file_paths" ("repo_id", "file_path");

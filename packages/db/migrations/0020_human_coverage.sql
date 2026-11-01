-- Human Coverage: people, code areas, evidence, failures, snapshots, answers, backfill runs.
-- All statements use IF NOT EXISTS / ON CONFLICT DO NOTHING — idempotent.

-- People (team members, current and departed)
CREATE TABLE IF NOT EXISTS "hc_people" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"       uuid        NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "github_login" text        NOT NULL,
  "github_id"    integer,
  "is_active"    boolean     NOT NULL DEFAULT true,
  "left_at"      timestamp,
  "created_at"   timestamp   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "hc_people_org_login_idx"
  ON "hc_people" ("org_id", "github_login");

-- Code areas (top-2 directory path by default)
CREATE TABLE IF NOT EXISTS "hc_code_areas" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"          uuid        NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "repo_id"         uuid        NOT NULL REFERENCES "repos"("id") ON DELETE CASCADE,
  "path"            text        NOT NULL,
  "is_critical"     boolean     NOT NULL DEFAULT false,
  "last_changed_at" timestamp,
  "created_at"      timestamp   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "hc_code_areas_org_repo_path_idx"
  ON "hc_code_areas" ("org_id", "repo_id", "path");
CREATE INDEX IF NOT EXISTS "hc_code_areas_org_repo_idx"
  ON "hc_code_areas" ("org_id", "repo_id");

-- Evidence events
-- type: incident_fix | successful_edit | substantive_review |
--       answered_question | understanding_click | explain_back | large_ai_change_unreviewed
CREATE TABLE IF NOT EXISTS "hc_evidence_events" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"      uuid        NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "person_id"   uuid        NOT NULL REFERENCES "hc_people"("id") ON DELETE CASCADE,
  "area_id"     uuid        NOT NULL REFERENCES "hc_code_areas"("id") ON DELETE CASCADE,
  "type"        text        NOT NULL,
  "weight"      real        NOT NULL DEFAULT 1.0,
  "occurred_at" timestamp   NOT NULL,
  "source_url"  text,
  "pr_number"   integer,
  "created_at"  timestamp   NOT NULL DEFAULT now()
);
-- Unique on (person, area, type, pr) so ON CONFLICT DO NOTHING makes the job idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "hc_evidence_person_area_type_pr_idx"
  ON "hc_evidence_events" ("person_id", "area_id", "type", "pr_number");
CREATE INDEX IF NOT EXISTS "hc_evidence_org_occurred_idx"
  ON "hc_evidence_events" ("org_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "hc_evidence_person_area_idx"
  ON "hc_evidence_events" ("person_id", "area_id");

-- Failures (revert-chain candidates)
-- state: candidate | confirmed | obsolete
CREATE TABLE IF NOT EXISTS "hc_failures" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"       uuid        NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "repo_id"      uuid        NOT NULL REFERENCES "repos"("id") ON DELETE CASCADE,
  "area_ids"     jsonb       NOT NULL DEFAULT '[]',
  "original_pr"  integer,
  "revert_pr"    integer,
  "fix_pr"       integer,
  "test_names"   jsonb       NOT NULL DEFAULT '[]',
  "state"        text        NOT NULL DEFAULT 'candidate',
  "confirmed_by" text,
  "confirmed_at" timestamp,
  "created_at"   timestamp   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "hc_failures_original_pr_idx"
  ON "hc_failures" ("org_id", "repo_id", "original_pr")
  WHERE "original_pr" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "hc_failures_org_repo_idx"
  ON "hc_failures" ("org_id", "repo_id");
CREATE INDEX IF NOT EXISTS "hc_failures_state_idx"
  ON "hc_failures" ("org_id", "state");

-- Coverage snapshots (computed summaries per area)
CREATE TABLE IF NOT EXISTS "hc_coverage_snapshots" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"          uuid        NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "area_id"         uuid        NOT NULL REFERENCES "hc_code_areas"("id") ON DELETE CASCADE,
  "coverage_count"  integer     NOT NULL DEFAULT 0,
  "people"          jsonb       NOT NULL DEFAULT '[]',
  "dark"            boolean     NOT NULL DEFAULT false,
  "fragile"         boolean     NOT NULL DEFAULT false,
  "computed_at"     timestamp   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hc_snapshots_org_area_idx"
  ON "hc_coverage_snapshots" ("org_id", "area_id");
CREATE INDEX IF NOT EXISTS "hc_snapshots_computed_idx"
  ON "hc_coverage_snapshots" ("org_id", "computed_at");

-- Understanding answers (user self-reports)
-- answer: understand | partly | ai_wrote_it
CREATE TABLE IF NOT EXISTS "hc_understanding_answers" (
  "id"         uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"     uuid        NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "pr_number"  integer     NOT NULL,
  "person_id"  uuid        NOT NULL REFERENCES "hc_people"("id") ON DELETE CASCADE,
  "answer"     text        NOT NULL,
  "created_at" timestamp   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "hc_answers_person_pr_idx"
  ON "hc_understanding_answers" ("person_id", "pr_number");
CREATE INDEX IF NOT EXISTS "hc_answers_org_idx"
  ON "hc_understanding_answers" ("org_id");

-- Backfill run state (resumability)
-- status: pending | running | complete | failed
CREATE TABLE IF NOT EXISTS "hc_backfill_runs" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"               uuid        NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "repo_id"              uuid        NOT NULL REFERENCES "repos"("id") ON DELETE CASCADE,
  "status"               text        NOT NULL DEFAULT 'pending',
  "since_date"           timestamp   NOT NULL,
  "last_processed_page"  integer     NOT NULL DEFAULT 0,
  "prs_fetched"          integer     NOT NULL DEFAULT 0,
  "evidence_created"     integer     NOT NULL DEFAULT 0,
  "error"                text,
  "started_at"           timestamp,
  "completed_at"         timestamp,
  "created_at"           timestamp   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "hc_backfill_repo_status_idx"
  ON "hc_backfill_runs" ("repo_id", "status");
